import mysql from 'mysql2/promise'
import type { Connection as ConexaoBruta } from 'mysql2'
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
import {
  type AlterColumnParams,
  DEFAULT_MAX_ROWS,
  LOTE_EXPORTACAO,
  PREVIEW_ROWS,
  applyPreviewLimit,
  hasExplicitLimit,
  exigirChave,
  exigirTipoValido,
  type DatabaseDriver,
  type QueryOptions
} from './types'
import { isMutation, splitStatements } from '../../shared/sql-shape'
import { toGridFromArrays } from './value-types'

export class MySQLDriver implements DatabaseDriver {
  readonly dialect: Dialect = 'mysql'
  private pool?: mysql.Pool
  private config?: ConnectionConfig
  /** connectionId do MySQL por queryId, para conseguir mandar KILL QUERY. */
  private running = new Map<string, number>()

  private buildOptions(config: ConnectionConfig): mysql.PoolOptions {
    return {
      host: config.host || 'localhost',
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database || undefined,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionLimit: 4,
      // Sem isso, DECIMAL e BIGINT chegam como string e o grid alinha errado.
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      multipleStatements: false,
      dateStrings: false,
      connectTimeout: 15_000
    }
  }

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    this.pool = mysql.createPool(this.buildOptions(config))
    // createPool é preguiçoso: forçamos um handshake pra falhar agora, não na primeira query.
    const conn = await this.pool.getConnection()
    conn.release()
  }

  async disconnect(): Promise<void> {
    await this.pool?.end()
    this.pool = undefined
    // Nada além disso. Havia aqui uma chamada a `buildOptions` cujo resultado
    // era descartado, com o comentário de que "forçava erro se reconectasse
    // sem config" — o que ela de fato fazia era estourar em quem só testou a
    // conexão e nunca a abriu, porque `this.config` ainda é indefinido nesse
    // caso. Desconectar precisa ser seguro em qualquer estado.
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const started = Date.now()
    let pool: mysql.Pool | undefined
    try {
      pool = mysql.createPool({ ...this.buildOptions(config), connectionLimit: 1 })
      const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT VERSION() AS version')
      return {
        ok: true,
        message: 'Conexão estabelecida',
        serverVersion: rows[0]?.version,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    } finally {
      await pool?.end().catch(() => undefined)
    }
  }

  async serverVersion(): Promise<string | undefined> {
    const [rows] = await this.require().query<mysql.RowDataPacket[]>('SELECT VERSION() AS v')
    return rows[0]?.v
  }

  private require(): mysql.Pool {
    if (!this.pool) throw new Error('Conexão MySQL não iniciada')
    return this.pool
  }

  /**
   * IMPORTANTE: todas as consultas de catálogo usam alias explícito.
   *
   * No MySQL 8 as views do `information_schema` devolvem os nomes de coluna em
   * MAIÚSCULAS (`TABLE_NAME`), enquanto no 5.7 vinham em minúsculas. Ler
   * `row.table_name` funciona em um e devolve `undefined` no outro — sem erro,
   * só uma lista de tabelas sem nome. O alias fixa a caixa que recebemos.
   */
  async listDatabases(): Promise<string[]> {
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT schema_name AS name FROM information_schema.schemata
       WHERE schema_name NOT IN ('information_schema','performance_schema','mysql','sys')
       ORDER BY schema_name`
    )
    return rows.map((r) => r.name as string)
  }

  async listTables(database?: string): Promise<TableInfo[]> {
    const db = database || this.config?.database
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT table_name AS name, table_type AS type, table_rows AS row_estimate
       FROM information_schema.tables
       WHERE table_schema = COALESCE(?, DATABASE())
       ORDER BY table_name`,
      [db ?? null]
    )
    return rows.map((r) => ({
      name: r.name as string,
      schema: db,
      type: (r.type === 'VIEW' ? 'view' : 'table') as TableInfo['type'],
      // row_estimate é uma estimativa do InnoDB, não uma contagem. Serve pra ordenar, não pra relatório.
      rowCount: r.row_estimate == null ? undefined : Number(r.row_estimate)
    }))
  }

  async listColumns(table: string, database?: string): Promise<ColumnInfo[]> {
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT column_name AS name, column_type AS type, is_nullable AS nullable,
              column_default AS default_value, column_key AS col_key,
              extra AS extra_info, column_comment AS comment
       FROM information_schema.columns
       WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
       ORDER BY ordinal_position`,
      [database ?? this.config?.database ?? null, table]
    )
    return rows.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: r.nullable === 'YES',
      defaultValue: (r.default_value as string) ?? null,
      isPrimaryKey: r.col_key === 'PRI',
      isForeignKey: r.col_key === 'MUL',
      extra: (r.extra_info as string) || null,
      comment: (r.comment as string) || null
    }))
  }

  async listIndexes(table: string, database?: string): Promise<IndexInfo[]> {
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT index_name AS name, column_name AS column_name, non_unique AS non_unique
       FROM information_schema.statistics
       WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
       ORDER BY index_name, seq_in_index`,
      [database ?? this.config?.database ?? null, table]
    )
    const byName = new Map<string, IndexInfo>()
    for (const r of rows) {
      const name = r.name as string
      const existing = byName.get(name)
      if (existing) existing.columns.push(r.column_name as string)
      else
        byName.set(name, {
          name,
          columns: [r.column_name as string],
          unique: Number(r.non_unique) === 0,
          primary: name === 'PRIMARY'
        })
    }
    return [...byName.values()]
  }

  async listRelations(table: string, database?: string): Promise<RelationInfo[]> {
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT k.constraint_name AS constraint_name,
              k.column_name AS column_name,
              k.referenced_table_name AS referenced_table,
              k.referenced_column_name AS referenced_column,
              r.delete_rule AS on_delete,
              r.update_rule AS on_update
       FROM information_schema.key_column_usage k
       LEFT JOIN information_schema.referential_constraints r
              ON r.constraint_name = k.constraint_name
             AND r.constraint_schema = k.table_schema
       WHERE k.table_schema = COALESCE(?, DATABASE())
         AND k.table_name = ?
         AND k.referenced_table_name IS NOT NULL`,
      [database ?? this.config?.database ?? null, table]
    )
    return rows.map((r) => ({
      constraintName: r.constraint_name as string,
      column: r.column_name as string,
      referencedTable: r.referenced_table as string,
      referencedColumn: r.referenced_column as string,
      onDelete: (r.on_delete as string) || undefined,
      onUpdate: (r.on_update as string) || undefined
    }))
  }

  async listAllRelations(database?: string): Promise<SchemaRelation[]> {
    // Alias explícito em toda coluna: o `information_schema` devolve os nomes
    // em MAIÚSCULA no MySQL 8 e em minúscula no 5.7, e ler a caixa errada não
    // dá erro — dá `undefined`, e o diagrama sai sem nenhuma ligação.
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT k.table_name AS source_table,
              k.constraint_name AS constraint_name,
              k.column_name AS column_name,
              k.referenced_table_name AS referenced_table,
              k.referenced_column_name AS referenced_column,
              r.delete_rule AS on_delete,
              r.update_rule AS on_update
       FROM information_schema.key_column_usage k
       LEFT JOIN information_schema.referential_constraints r
              ON r.constraint_name = k.constraint_name
             AND r.constraint_schema = k.table_schema
       WHERE k.table_schema = COALESCE(?, DATABASE())
         AND k.referenced_table_name IS NOT NULL
       ORDER BY k.table_name, k.constraint_name, k.ordinal_position`,
      [database ?? this.config?.database ?? null]
    )
    return rows.map((r) => ({
      table: r.source_table as string,
      constraintName: r.constraint_name as string,
      column: r.column_name as string,
      referencedTable: r.referenced_table as string,
      referencedColumn: r.referenced_column as string,
      onDelete: (r.on_delete as string) || undefined,
      onUpdate: (r.on_update as string) || undefined
    }))
  }

  async streamQuery(
    sql: string,
    options: { database?: string },
    aoReceber: (bloco: { columns: string[]; rows: unknown[][] }) => Promise<void>
  ): Promise<void> {
    const conn = await this.require().getConnection()
    try {
      if (options.database) await conn.query(`USE \`${options.database.replace(/`/g, '``')}\``)

      // Exportação é leitura. Recusar aqui resolve dois problemas de uma vez:
      //
      // 1. O modo somente-leitura volta a valer. A guarda existia só no
      //    `query`, e este canal recebe SQL do renderer — a promessa precisa
      //    valer nos dois caminhos, não em um.
      // 2. **O travamento.** `.stream()` sobre um comando que não devolve
      //    conjunto de resultados nunca emite o fim: o `for await` fica
      //    esperando para sempre, e a exportação pendura sem erro e sem forma
      //    de cancelar. Verificado contra MySQL real com `CREATE TABLE`.
      if (isMutation(sql)) {
        throw new Error(
          'A exportação só aceita comandos que devolvem linhas. ' +
            'Este comando altera o banco e não produz resultado para gravar.'
        )
      }

      // `conn.query` do wrapper de promise devolve uma Promise, e Promise não
      // tem `.stream()`. O objeto por baixo é a conexão da API de callback,
      // onde o mysql2 expõe os eventos e o fluxo — o wrapper só o tipa como
      // ele mesmo, daí a conversão.
      const bruta = conn.connection as unknown as ConexaoBruta
      const consulta = bruta.query({ sql, rowsAsArray: true })
      let columns: string[] = []
      consulta.on('fields', (campos: mysql.FieldPacket[]) => {
        columns = campos.map((c) => c.name)
      })

      let bloco: unknown[][] = []
      // `for await` sobre o stream aplica contrapressão sozinho: enquanto
      // estamos escrevendo em disco, o mysql2 para de puxar do socket.
      for await (const linha of consulta.stream()) {
        bloco.push(linha as unknown[])
        if (bloco.length >= LOTE_EXPORTACAO) {
          await aoReceber({ columns, rows: bloco })
          bloco = []
        }
      }
      if (bloco.length) await aoReceber({ columns, rows: bloco })
    } finally {
      conn.release()
    }
  }

  async getCreateStatement(table: string, database?: string): Promise<string> {
    const qualified = database
      ? `${quoteIdent(database)}.${quoteIdent(table)}`
      : quoteIdent(table)
    const [rows] = await this.require().query<mysql.RowDataPacket[]>(
      `SHOW CREATE TABLE ${qualified}`
    )
    // A coluna varia entre 'Create Table' e 'Create View' conforme o objeto.
    const row = rows[0] ?? {}
    return (row['Create Table'] ?? row['Create View'] ?? '') as string
  }

  buildDangerStatement(kind: 'truncate' | 'drop', table: string): string {
    return kind === 'truncate'
      ? `TRUNCATE TABLE ${quoteIdent(table)};`
      : `DROP TABLE ${quoteIdent(table)};`
  }

  /**
   * `MODIFY COLUMN` reescreve a definição inteira da coluna.
   *
   * É a armadilha desta operação: mandar só o tipo novo apaga `NOT NULL`,
   * `DEFAULT`, `COMMENT` e `AUTO_INCREMENT` sem um aviso sequer — a coluna
   * passa a aceitar nulo e perde o padrão, e nada na tela denuncia. Por isso
   * lemos o catálogo antes e reemitimos tudo que já estava lá.
   */
  async buildAlterColumnTypeStatement(params: AlterColumnParams): Promise<string> {
    const tipo = exigirTipoValido(params.newType)
    const [linhas] = await this.require().query<mysql.RowDataPacket[]>(
      `SELECT IS_NULLABLE AS nulavel, COLUMN_DEFAULT AS padrao,
              COLUMN_COMMENT AS comentario, EXTRA AS extra
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [params.database ?? this.config?.database, params.table, params.column]
    )
    const atual = linhas[0]
    if (!atual) throw new Error(`Coluna ${params.column} não encontrada em ${params.table}.`)

    const partes = [
      `ALTER TABLE ${quoteIdent(params.table)}`,
      `MODIFY COLUMN ${quoteIdent(params.column)} ${tipo}`
    ]
    partes.push(atual.nulavel === 'YES' ? 'NULL' : 'NOT NULL')

    if (atual.padrao !== null && atual.padrao !== undefined) {
      // CURRENT_TIMESTAMP e afins são expressão, não literal: citar quebraria.
      const ehExpressao = /^(CURRENT_TIMESTAMP|NOW\(\)|\()/i.test(String(atual.padrao))
      partes.push(`DEFAULT ${ehExpressao ? atual.padrao : quoteLiteral(String(atual.padrao))}`)
    }
    if (atual.extra) partes.push(String(atual.extra).toUpperCase())
    if (atual.comentario) partes.push(`COMMENT ${quoteLiteral(String(atual.comentario))}`)

    return `${partes.join(' ')};`
  }

  async updateCell(params: {
    table: string
    database?: string
    column: string
    value: unknown
    keys: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }> {
    if (this.config?.readOnly) {
      throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
    }
    const chave = exigirChave(params.keys)
    const alvo = params.database
      ? `${quoteIdent(params.database)}.${quoteIdent(params.table)}`
      : quoteIdent(params.table)

    const onde = chave.map(([col]) => `${quoteIdent(col)} = ?`).join(' AND ')
    const sql = `UPDATE ${alvo} SET ${quoteIdent(params.column)} = ? WHERE ${onde}`
    const valores = [params.value, ...chave.map(([, v]) => v)]

    return this.escreverComTransacao(sql, valores)
  }

  async insertRow(params: {
    table: string
    database?: string
    values: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }> {
    if (this.config?.readOnly) {
      throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
    }
    const entradas = Object.entries(params.values)
    if (entradas.length === 0) {
      throw new Error('Preencha ao menos uma coluna para inserir a linha.')
    }
    const alvo = params.database
      ? `${quoteIdent(params.database)}.${quoteIdent(params.table)}`
      : quoteIdent(params.table)

    const colunas = entradas.map(([c]) => quoteIdent(c)).join(', ')
    const marcas = entradas.map(() => '?').join(', ')
    const sql = `INSERT INTO ${alvo} (${colunas}) VALUES (${marcas})`

    return this.escreverComTransacao(sql, entradas.map(([, v]) => v))
  }

  async deleteRow(params: {
    table: string
    database?: string
    keys: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }> {
    if (this.config?.readOnly) {
      throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
    }
    const chave = exigirChave(params.keys)
    const alvo = params.database
      ? `${quoteIdent(params.database)}.${quoteIdent(params.table)}`
      : quoteIdent(params.table)

    const onde = chave.map(([col]) => `${quoteIdent(col)} = ?`).join(' AND ')
    const sql = `DELETE FROM ${alvo} WHERE ${onde}`

    return this.escreverComTransacao(sql, chave.map(([, v]) => v))
  }

  /**
   * Roda a escrita em transação e desfaz se ela tocar mais de uma linha.
   *
   * A edição em grade só existe porque essa rede existe: uma chave mal formada
   * que casasse com muitas linhas reescreveria a tabela sem qualquer aviso, e
   * não há desfazer depois do commit.
   */
  private async escreverComTransacao(
    sql: string,
    valores: unknown[]
  ): Promise<{ affectedRows: number; statement: string }> {
    const conn = await this.require().getConnection()
    try {
      await conn.beginTransaction()
      const [resultado] = await conn.execute(sql, valores as never[])
      const afetadas = (resultado as mysql.ResultSetHeader).affectedRows

      if (afetadas > 1) {
        await conn.rollback()
        throw new Error(
          `A operação afetaria ${afetadas} linhas, não uma. Foi desfeita por segurança.`
        )
      }
      await conn.commit()
      return { affectedRows: afetadas, statement: sql }
    } catch (error) {
      await conn.rollback().catch(() => undefined)
      throw error
    } finally {
      conn.release()
    }
  }

  async query(sql: string, options: QueryOptions): Promise<QueryResult[]> {
    const pool = this.require()
    const statements = splitStatements(sql)
    const results: QueryResult[] = []

    const conn = await pool.getConnection()
    try {
      const [idRows] = await conn.query<mysql.RowDataPacket[]>('SELECT CONNECTION_ID() AS id')
      this.running.set(options.queryId, Number(idRows[0].id))

      if (options.database) await conn.query(`USE \`${options.database.replace(/`/g, '``')}\``)

      for (const statement of statements) {
        if (this.config?.readOnly && isMutation(statement)) {
          throw new Error(
            'Conexão em modo somente-leitura: comandos de escrita estão bloqueados.'
          )
        }
        // Sem LIMIT próprio, a query vai ao banco já limitada — cortar depois
        // de receber não impede a varredura nem o tráfego.
        const explicit = hasExplicitLimit(statement)
        const maxRows =
          options.maxRows ??
          (explicit ? DEFAULT_MAX_ROWS : (options.previewRows ?? PREVIEW_ROWS))
        // Uma linha a mais que o teto: é assim que sabemos que havia mais e
        // conseguimos avisar "mostrando as primeiras N". Com LIMIT exato o
        // resultado nunca sobra e o aviso nunca apareceria.
        const effective = explicit ? statement : applyPreviewLimit(statement, maxRows + 1)

        const started = Date.now()
        // `rowsAsArray` é obrigatório: no formato de objeto, `SELECT c.id, p.id`
        // de um JOIN colapsa as duas colunas homônimas em uma só, e a UI mostra
        // uma coluna a menos sem qualquer aviso.
        const [data, fields] = await conn.query({ sql: effective, rowsAsArray: true })
        const durationMs = Date.now() - started

        if (Array.isArray(data)) {
          const rows = data as unknown as unknown[][]
          const truncated = rows.length > maxRows
          const packets = (fields as mysql.FieldPacket[]) ?? []
          const { columns, matrix } = toGridFromArrays(
            packets.map((f) => f.name),
            truncated ? rows.slice(0, maxRows) : rows,
            packets.map((f) => mysqlTypeName(f.type))
          )
          results.push({
            columns,
            rows: matrix,
            rowCount: matrix.length,
            durationMs,
            statement,
            truncatedAt: truncated ? maxRows : undefined
          })
        } else {
          const header = data as mysql.ResultSetHeader
          results.push({
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: header.affectedRows,
            durationMs,
            statement
          })
        }
      }
      return results
    } finally {
      this.running.delete(options.queryId)
      conn.release()
    }
  }

  async cancel(queryId: string): Promise<void> {
    const connectionId = this.running.get(queryId)
    if (!connectionId || !this.pool) return
    // KILL QUERY precisa de outra conexão — a original está ocupada esperando o servidor.
    await this.pool.query(`KILL QUERY ${connectionId}`).catch(() => undefined)
  }
}

/** Crase é o delimitador de identificador do MySQL; a crase interna dobra. */
function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** Códigos numéricos de tipo do protocolo MySQL — só o que muda a formatação do grid. */
function mysqlTypeName(code: number | undefined): string {
  switch (code) {
    case 1: case 2: case 3: case 8: case 9: return 'int'
    case 4: case 5: return 'double'
    case 246: return 'decimal'
    case 7: case 12: return 'datetime'
    case 10: return 'date'
    case 11: return 'time'
    case 13: return 'year'
    case 245: return 'json'
    case 249: case 250: case 251: case 252: return 'blob'
    default: return 'varchar'
  }
}

/**
 * Literal entre aspas simples, escapando as internas.
 *
 * Serve só para reemitir DEFAULT e COMMENT já existentes no catálogo ao
 * remontar a definição da coluna — não é caminho para valor vindo do usuário,
 * que sempre vai parametrizado.
 */
function quoteLiteral(valor: string): string {
  return `'${valor.replace(/'/g, "''")}'`
}
