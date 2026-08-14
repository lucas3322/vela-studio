import { MongoClient, type Db, type Document } from 'mongodb'
import type {
  ColumnInfo,
  ConnectionConfig,
  Dialect,
  IndexInfo,
  QueryResult,
  RelationInfo,
  SchemaRelation,
  TableInfo,
  TestResult
} from '../../shared/types'
import { DEFAULT_MAX_ROWS, PREVIEW_ROWS, type DatabaseDriver, type QueryOptions } from './types'
import { toGrid } from './value-types'
import { parseMongoCommand, splitMongoCommands, type MongoPlan } from './mongo-parser'

/** Operações que alteram dados — bloqueadas no modo somente-leitura. */
const WRITE_METHODS = new Set([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'drop', 'createIndex', 'dropIndex',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'renameCollection'
])

/**
 * Teto da exportação do MongoDB, em documentos.
 *
 * Existe porque este driver não transmite em blocos (ver `streamQuery`). Sem
 * ele, exportar uma coleção de milhões de documentos derrubaria o processo
 * principal sem mensagem nenhuma.
 */
const TETO_EXPORTACAO_MONGO = 500_000

export class MongoDriver implements DatabaseDriver {
  readonly dialect: Dialect = 'mongodb'
  private client?: MongoClient
  private config?: ConnectionConfig
  private currentDb?: string

  private buildUri(config: ConnectionConfig): string {
    if (config.connectionString?.trim()) return config.connectionString.trim()
    const auth =
      config.user
        ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@`
        : ''
    const host = config.host || 'localhost'
    const port = config.port || 27017
    return `mongodb://${auth}${host}:${port}`
  }

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    this.client = new MongoClient(this.buildUri(config), { serverSelectionTimeoutMS: 15_000 })
    await this.client.connect()
    this.currentDb = config.database || this.client.db().databaseName
  }

  async disconnect(): Promise<void> {
    await this.client?.close()
    this.client = undefined
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const started = Date.now()
    const client = new MongoClient(this.buildUri(config), { serverSelectionTimeoutMS: 10_000 })
    try {
      await client.connect()
      const info = await client.db('admin').command({ buildInfo: 1 })
      return {
        ok: true,
        message: 'Conexão estabelecida',
        serverVersion: info.version as string,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async serverVersion(): Promise<string | undefined> {
    const info = await this.require().db('admin').command({ buildInfo: 1 })
    return info.version as string
  }

  private require(): MongoClient {
    if (!this.client) throw new Error('Conexão MongoDB não iniciada')
    return this.client
  }

  private db(name?: string): Db {
    return this.require().db(name || this.currentDb || this.config?.database)
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.require().db('admin').admin().listDatabases()
    return result.databases.map((d) => d.name).filter((n) => !['admin', 'local', 'config'].includes(n))
  }

  async listTables(database?: string): Promise<TableInfo[]> {
    const collections = await this.db(database).listCollections({}, { nameOnly: false }).toArray()
    return collections.map((c) => ({
      name: c.name,
      schema: database || this.currentDb,
      type: (c.type === 'view' ? 'view' : 'collection') as TableInfo['type']
    }))
  }

  /**
   * Mongo não tem schema declarado. Amostramos documentos e inferimos os campos —
   * é exatamente o que o autocomplete precisa, e a frequência avisa quando um campo
   * só existe em parte dos documentos.
   */
  async listColumns(collection: string, database?: string): Promise<ColumnInfo[]> {
    const SAMPLE = 120
    const docs = await this.db(database)
      .collection(collection)
      .find({}, { limit: SAMPLE, projection: {} })
      .toArray()

    if (docs.length === 0) return []

    const fields = new Map<string, { types: Set<string>; count: number }>()
    for (const doc of docs) collectFields(doc, '', fields)

    return [...fields.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([name, info]) => ({
        name,
        type: [...info.types].join(' | '),
        nullable: info.count < docs.length,
        isPrimaryKey: name === '_id',
        frequency: Math.round((info.count / docs.length) * 100)
      }))
  }

  async listIndexes(collection: string, database?: string): Promise<IndexInfo[]> {
    const indexes = await this.db(database).collection(collection).indexes()
    return indexes.map((idx) => ({
      name: idx.name ?? '(sem nome)',
      columns: Object.keys(idx.key ?? {}),
      unique: !!idx.unique,
      primary: idx.name === '_id_'
    }))
  }

  /** Mongo não declara chave estrangeira. Devolvemos vazio em vez de inventar. */
  async listRelations(): Promise<RelationInfo[]> {
    return []
  }

  /**
   * O MongoDB não declara ligação entre coleções — a integridade vive na
   * aplicação. Devolver vazio aqui é a resposta correta, e a modelagem usa
   * isso para dizer o que está acontecendo em vez de desenhar coleções soltas
   * como se o banco realmente não tivesse relação nenhuma.
   */
  async listAllRelations(): Promise<SchemaRelation[]> {
    return []
  }

  /**
   * Exportação do MongoDB.
   *
   * Diferente dos drivers SQL, aqui **não há fluxo real**: a consulta do Mongo
   * é uma expressão avaliada (`db.x.find(...).sort(...)`), e o resultado já
   * chega materializado do `execute`. Transformar isso em cursor exigiria
   * reescrever o avaliador inteiro.
   *
   * Então o bloco sai de uma vez. A consequência é honesta e precisa ser dita:
   * exportar uma coleção muito grande daqui consome memória proporcional ao
   * tamanho dela, ao contrário do MySQL, do PostgreSQL e do SQLite. O teto
   * existe para o app não morrer sem explicação — quem bater nele recebe aviso,
   * não um arquivo pela metade.
   */
  async streamQuery(
    source: string,
    options: { database?: string },
    aoReceber: (bloco: { columns: string[]; rows: unknown[][] }) => Promise<void>
  ): Promise<void> {
    const resultados = await this.query(source, {
      queryId: `export_${Date.now()}`,
      database: options.database,
      maxRows: TETO_EXPORTACAO_MONGO
    })

    for (const resultado of resultados) {
      if (resultado.columns.length === 0) continue
      await aoReceber({
        columns: resultado.columns.map((c) => c.name),
        rows: resultado.rows
      })
      if (resultado.truncatedAt) {
        throw new Error(
          `A coleção passou de ${TETO_EXPORTACAO_MONGO.toLocaleString('pt-BR')} documentos, ` +
            'que é o teto da exportação do MongoDB. Estreite a consulta com um filtro ' +
            'ou exporte por partes usando .skip() e .limit().'
        )
      }
    }
  }

  /**
   * MongoDB não tem DDL: a coleção nasce no primeiro insert e o formato dos
   * documentos vive na aplicação. O mais próximo e mais útil é o script que
   * recria a coleção com os mesmos índices, mais o formato observado como
   * comentário — é o que se leva para outro ambiente.
   */
  async getCreateStatement(collection: string, database?: string): Promise<string> {
    const [indexes, fields] = await Promise.all([
      this.listIndexes(collection, database),
      this.listColumns(collection, database)
    ])

    const lines = [
      `// MongoDB não declara schema — este script recria a coleção e seus índices.`,
      `db.createCollection("${collection}")`,
      ''
    ]

    for (const index of indexes) {
      if (index.name === '_id_') continue // criado automaticamente
      const keys = index.columns.map((c) => `"${c}": 1`).join(', ')
      lines.push(
        `db.${collection}.createIndex({ ${keys} }` +
          (index.unique ? `, { unique: true, name: "${index.name}" }` : `, { name: "${index.name}" }`) +
          ')'
      )
    }

    if (fields.length) {
      lines.push('', '// Formato observado numa amostra de documentos:')
      for (const field of fields) {
        lines.push(`//   ${field.name}: ${field.type}  (${field.frequency}% dos documentos)`)
      }
    }

    return lines.join('\n')
  }

  buildDangerStatement(kind: 'truncate' | 'drop', collection: string): string {
    // "Esvaziar" no Mongo é deleteMany({}); "apagar" é drop().
    return kind === 'truncate'
      ? `db.${collection}.deleteMany({})`
      : `db.${collection}.drop()`
  }

  /**
   * Edição em grade ainda não vale para o MongoDB.
   *
   * O modelo é diferente: não há chave primária declarada além do `_id`, os
   * documentos têm formatos distintos entre si, e um campo pode ser aninhado.
   * Fazer isso direito pede uma interface própria — melhor recusar com clareza
   * do que oferecer algo que edita a coisa errada.
   */
  /**
   * O MongoDB não declara tipo de campo: cada documento carrega o seu. Não há
   * o que alterar no schema porque não há schema.
   */
  async buildAlterColumnTypeStatement(): Promise<string> {
    throw new Error(
      'O MongoDB não tem tipo de coluna: o tipo vive em cada documento. Para converter um campo, ' +
        'use uma atualização em massa no editor — por exemplo com $convert dentro de um pipeline.'
    )
  }

  async updateCell(): Promise<{ affectedRows: number; statement: string }> {
    throw new Error(
      'Edição direta na grade ainda não é suportada no MongoDB. ' +
        'Use o editor: db.colecao.updateOne({ _id: ... }, { $set: { campo: valor } })'
    )
  }

  async deleteRow(): Promise<{ affectedRows: number; statement: string }> {
    throw new Error(
      'Exclusão direta na grade ainda não é suportada no MongoDB. ' +
        'Use o editor: db.colecao.deleteOne({ _id: ... })'
    )
  }

  async query(source: string, options: QueryOptions): Promise<QueryResult[]> {
    // Com `.limit()` explícito respeitamos o pedido até o teto de segurança;
    // sem ele, devolvemos só a prévia.
    const explicit = /\.limit\s*\(/.test(source)
    const maxRows =
      options.maxRows ??
      (explicit ? DEFAULT_MAX_ROWS : (options.previewRows ?? PREVIEW_ROWS))
    const results: QueryResult[] = []

    for (const command of splitMongoCommands(source)) {
      const plan = parseMongoCommand(command)
      if (this.config?.readOnly && WRITE_METHODS.has(plan.method)) {
        throw new Error('Conexão em modo somente-leitura: operações de escrita estão bloqueadas.')
      }
      const started = Date.now()
      const outcome = await this.execute(plan, options.database, maxRows)
      const durationMs = Date.now() - started

      if (Array.isArray(outcome)) {
        const truncated = outcome.length > maxRows
        const rows = truncated ? outcome.slice(0, maxRows) : outcome
        const { columns, matrix } = toGrid(rows as Record<string, unknown>[])
        results.push({
          columns,
          rows: matrix,
          rowCount: matrix.length,
          durationMs,
          statement: command,
          truncatedAt: truncated ? maxRows : undefined
        })
      } else if (outcome && typeof outcome === 'object') {
        const { columns, matrix } = toGrid([outcome as Record<string, unknown>])
        results.push({ columns, rows: matrix, rowCount: 1, durationMs, statement: command })
      } else {
        const { columns, matrix } = toGrid([{ resultado: outcome }])
        results.push({ columns, rows: matrix, rowCount: 1, durationMs, statement: command })
      }
    }
    return results
  }

  private async execute(plan: MongoPlan, database: string | undefined, maxRows: number): Promise<unknown> {
    const db = this.db(database)

    if (plan.method === 'listCollections') {
      return (await db.listCollections().toArray()) as Document[]
    }

    const coll = db.collection(plan.collection)
    const [first, second, third] = plan.args as [Document, Document, Document]

    switch (plan.method) {
      case 'find': {
        let cursor = coll.find(first ?? {}, second ?? {})
        let explicitLimit = false
        for (const link of plan.chain) {
          const arg = link.args[0]
          switch (link.name) {
            case 'sort': cursor = cursor.sort(arg as Document); break
            case 'limit': cursor = cursor.limit(Number(arg)); explicitLimit = true; break
            case 'skip': cursor = cursor.skip(Number(arg)); break
            case 'project': cursor = cursor.project(arg as Document); break
            case 'toArray': case 'pretty': break
            case 'count': return coll.countDocuments(first ?? {})
            default: break
          }
        }
        // Sem limite explícito, cortamos: `find({})` numa coleção de milhões trava a IDE.
        if (!explicitLimit) cursor = cursor.limit(maxRows + 1)
        return cursor.toArray()
      }
      case 'findOne':
        return coll.findOne(first ?? {}, second ?? {})
      case 'aggregate': {
        let cursor = coll.aggregate((first as unknown as Document[]) ?? [], second)
        for (const link of plan.chain) {
          if (link.name === 'limit') cursor = cursor.limit(Number(link.args[0]))
          if (link.name === 'sort') cursor = cursor.sort(link.args[0] as Document)
        }
        return cursor.toArray()
      }
      case 'countDocuments': case 'count':
        return { count: await coll.countDocuments(first ?? {}) }
      case 'estimatedDocumentCount':
        return { count: await coll.estimatedDocumentCount() }
      case 'distinct':
        return (await coll.distinct(first as unknown as string, second ?? {})).map((v) => ({ valor: v }))
      case 'insertOne':
        return coll.insertOne(first)
      case 'insertMany':
        return coll.insertMany(first as unknown as Document[])
      case 'updateOne':
        return coll.updateOne(first, second, third)
      case 'updateMany':
        return coll.updateMany(first, second, third)
      case 'replaceOne':
        return coll.replaceOne(first, second, third)
      case 'deleteOne':
        return coll.deleteOne(first)
      case 'deleteMany':
        return coll.deleteMany(first)
      case 'findOneAndUpdate':
        return coll.findOneAndUpdate(first, second, third)
      case 'findOneAndDelete':
        return coll.findOneAndDelete(first, second)
      case 'createIndex':
        return { index: await coll.createIndex(first as unknown as Document, second) }
      case 'getIndexes': case 'indexes':
        return coll.indexes()
      case 'drop':
        return { dropped: await coll.drop() }
      case 'stats':
        return db.command({ collStats: plan.collection })
      default:
        throw new Error(
          `Operação "${plan.method}" ainda não é suportada. ` +
            'Disponíveis: find, findOne, aggregate, countDocuments, distinct, insertOne/Many, updateOne/Many, deleteOne/Many.'
        )
    }
  }

  /** O driver do Mongo cancela pelo fechamento do cursor; não expomos kill por operação. */
  async cancel(): Promise<void> {}
}

/** Percorre o documento montando `endereco.cidade` para campos aninhados. */
function collectFields(
  doc: Document,
  prefix: string,
  acc: Map<string, { types: Set<string>; count: number }>,
  depth = 0
): void {
  if (depth > 3) return
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix ? `${prefix}.${key}` : key
    const entry = acc.get(path) ?? { types: new Set<string>(), count: 0 }
    entry.count++
    entry.types.add(mongoTypeOf(value))
    acc.set(path, entry)

    if (value && typeof value === 'object' && !Array.isArray(value) && isPlainDocument(value)) {
      collectFields(value as Document, path, acc, depth + 1)
    }
  }
}

function isPlainDocument(value: object): boolean {
  const name = value.constructor?.name
  return name === 'Object'
}

function mongoTypeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (value instanceof Date) return 'date'
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name
    if (name && name !== 'Object') return name
    return 'object'
  }
  return typeof value
}
