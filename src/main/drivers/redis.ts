import Redis from 'ioredis'
import type { ChainableCommander } from 'ioredis'
import type {
  ColumnInfo,
  ConnectionConfig,
  Dialect,
  IndexInfo,
  QueryColumn,
  QueryResult,
  RelationInfo,
  SchemaRelation,
  TableInfo,
  TestResult
} from '../../shared/types'
import { PREVIEW_ROWS, exigirChave, type DatabaseDriver, type QueryOptions } from './types'
import { splitStatements } from '../../shared/sql-shape'
import { toGrid } from './value-types'
import {
  PSEUDO_TABLES,
  TABLE_TO_REDIS_TYPE,
  extractMatchPattern,
  isPseudoTableName,
  isRedisWrite,
  redisTypeForTable,
  tokenizeRedisCommand,
  type PseudoTable
} from './redis-parser'

/**
 * O Redis não tem tabela — sintetizamos cinco, uma por tipo de valor, e cada
 * uma tem sempre as mesmas três colunas (`key`, `value`, `ttl`). Todo o
 * mapeamento pseudo-tabela ↔ tipo Redis mora em `redis-parser.ts`, puro e
 * testável sem `ioredis` nem banco no ar.
 *
 * Convenção de navegação: a UI carrega a "tabela" `hashes` chamando
 * `query('SCAN hashes MATCH padrao*')` — não é um `SCAN` de verdade (que
 * devolveria só chaves), é a nossa notação para "monte o grid de três colunas
 * dessa pseudo-tabela". Funciona porque `SCAN <pseudo-tabela>` nunca é um
 * comando Redis válido de verdade (o primeiro argumento do SCAN real é
 * sempre um cursor numérico), então não há ambiguidade com o SCAN cru que
 * alguém digite no console. Um `SCAN 0 MATCH * TYPE hash` continua sendo
 * executado como o comando real, devolvendo só as chaves — é o que o resto
 * do console espera.
 */

const KEEPTTL = 'KEEPTTL'

export class RedisDriver implements DatabaseDriver {
  readonly dialect: Dialect = 'redis'
  private client?: Redis
  private config?: ConnectionConfig
  /** Índice do banco selecionado nesta conexão — Redis não tem "USE" por chamada, é por conexão inteira. */
  private currentDbIndex = '0'
  /** queryIds marcados para cancelamento cooperativo (ver `cancel`). */
  private cancelled = new Set<string>()

  private buildClient(config: ConnectionConfig): Redis {
    const common = {
      lazyConnect: true,
      // Sem retry automático: se a conexão falhar, falha agora — igual ao
      // handshake forçado dos outros drivers. Deixar o ioredis tentar de novo
      // sozinho faria `connect()` nunca rejeitar em host errado.
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      connectTimeout: 10_000
    }

    if (config.connectionString?.trim()) {
      // A URL redis://[usuario:senha@]host:porta/indice já carrega usuário,
      // senha e índice do banco — o ioredis entende nativamente.
      return new Redis(config.connectionString.trim(), common)
    }

    return new Redis({
      ...common,
      host: config.host || 'localhost',
      port: config.port || 6379,
      username: config.user || undefined,
      password: config.password || undefined,
      tls: config.ssl ? {} : undefined
    })
  }

  /**
   * Erros de cluster chegam como texto de resposta do próprio Redis
   * (`CLUSTERDOWN`, `MOVED <slot> <host>:<porta>`), não como um campo
   * estruturado — não há suporte a cluster nesta versão, então em vez de
   * deixar o erro cru confuso ("MOVED 3999 10.0.0.4:6379") explicamos o que
   * está acontecendo.
   */
  private friendlyConnectError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error)
    if (/CLUSTERDOWN|^MOVED\b|^ASK\b|cluster support disabled/i.test(message)) {
      return new Error(
        'Este servidor Redis está em modo cluster, que o Vela Studio ainda não suporta. ' +
          'Conecte diretamente a um nó autônomo, ou aguarde suporte a cluster numa versão futura.'
      )
    }
    return error instanceof Error ? error : new Error(message)
  }

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    const client = this.buildClient(config)
    try {
      await client.connect()
      await client.ping()
    } catch (error) {
      client.disconnect()
      throw this.friendlyConnectError(error)
    }

    const dbIndex = config.database?.trim() || '0'
    if (dbIndex !== '0') {
      try {
        await client.select(Number(dbIndex))
      } catch (error) {
        client.disconnect()
        throw new Error(`Não foi possível selecionar o banco ${dbIndex}: ${(error as Error).message}`)
      }
    }

    this.client = client
    this.currentDbIndex = dbIndex
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => this.client?.disconnect())
    }
    this.client = undefined
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const started = Date.now()
    const client = this.buildClient(config)
    try {
      await client.connect()
      await client.ping()
      const info = await client.info('server')
      const version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim()
      return {
        ok: true,
        message: 'Conexão estabelecida',
        serverVersion: version,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, message: this.friendlyConnectError(error).message }
    } finally {
      client.disconnect()
    }
  }

  async serverVersion(): Promise<string | undefined> {
    const info = await this.require().info('server')
    return /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim()
  }

  private require(): Redis {
    if (!this.client) throw new Error('Conexão Redis não iniciada')
    return this.client
  }

  /**
   * Troca o índice do banco selecionado quando `database` pede um diferente
   * do atual. Diferente do MySQL (onde `USE` é por conexão do pool, e o pool
   * tem várias), aqui há uma conexão só por driver — então a troca vale para
   * as chamadas seguintes até a próxima troca, exatamente como o `USE` faz.
   */
  private async ensureDatabase(database?: string): Promise<void> {
    const target = (database ?? this.config?.database ?? '0').trim() || '0'
    if (target === this.currentDbIndex) return
    await this.require().select(Number(target))
    this.currentDbIndex = target
  }

  /**
   * `CONFIG GET databases` diz quantos bancos o servidor tem. Redis
   * gerenciado (ElastiCache, Azure Cache, Upstash…) costuma bloquear
   * `CONFIG` por política — nesse caso caímos para o banco atualmente
   * selecionado, que é a única coisa que sabemos com certeza que existe.
   */
  async listDatabases(): Promise<string[]> {
    try {
      const reply = (await this.require().call('CONFIG', 'GET', 'databases')) as string[]
      const total = Number(reply?.[1])
      if (Number.isFinite(total) && total > 0) {
        return Array.from({ length: total }, (_, i) => String(i))
      }
    } catch {
      // Segue para o fallback.
    }
    return [this.currentDbIndex]
  }

  async listTables(database?: string): Promise<TableInfo[]> {
    await this.ensureDatabase(database)
    return PSEUDO_TABLES.map((name) => ({
      name,
      schema: this.currentDbIndex,
      type: 'collection' as const,
      // Contar de verdade exigiria varrer o keyspace inteiro com SCAN — nem
      // o Redis tem essa contagem por tipo pronta. Melhor não afirmar nada.
      rowCount: undefined
    }))
  }

  /**
   * Fixo por construção: toda pseudo-tabela tem `key`, `value` e `ttl`, não
   * importa o tipo Redis por trás. O que muda é o tipo declarado da coluna
   * `value` — texto cru nas strings, JSON nas demais.
   */
  async listColumns(table: string): Promise<ColumnInfo[]> {
    const redisType = redisTypeForTable(table)
    return [
      { name: 'key', type: 'string', nullable: false, isPrimaryKey: true },
      {
        name: 'value',
        type: redisType === 'string' ? 'string' : 'json',
        nullable: false,
        isPrimaryKey: false
      },
      { name: 'ttl', type: 'seconds', nullable: true, isPrimaryKey: false }
    ]
  }

  /** Redis não tem índice secundário no sentido de banco relacional. */
  async listIndexes(): Promise<IndexInfo[]> {
    return []
  }

  /** Redis não declara ligação entre chaves — nada aqui para inventar. */
  async listRelations(): Promise<RelationInfo[]> {
    return []
  }

  async listAllRelations(): Promise<SchemaRelation[]> {
    return []
  }

  /**
   * O Redis não tem DDL nem tipo de coluna: cada chave carrega o próprio
   * dado, e a "tabela" é uma lente que o Vela Studio desenha por cima do
   * tipo do valor. Não existe comando `CREATE` para reproduzir aqui.
   */
  async getCreateStatement(): Promise<string> {
    throw new Error(
      'O Redis não tem DDL: não existe um "CREATE" para uma pseudo-tabela. ' +
        'Para recriar as chaves em outro banco, use o editor com SET, HSET, RPUSH, SADD ou ZADD.'
    )
  }

  /**
   * Mesma lógica do `mongodb.ts`: sem schema declarado, não há tipo de
   * coluna para alterar. `key` é sempre texto; `value` tem a forma que o tipo
   * Redis da chave impõe (string, hash, list, set ou sorted set) — trocar
   * isso é recriar a chave com outro comando, não um ALTER.
   */
  async buildAlterColumnTypeStatement(): Promise<string> {
    throw new Error(
      'O Redis não tem tipo de coluna: "value" tem a forma que o tipo da chave impõe. ' +
        'Para mudar o tipo, apague a chave e recrie-a com o comando certo (SET, HSET, RPUSH, SADD ou ZADD).'
    )
  }

  /**
   * Redis não tem uma sentença atômica equivalente a `TRUNCATE`/`DROP` para
   * "todas as chaves de um tipo" — só existe por chave (`DEL`) ou o banco
   * inteiro (`FLUSHDB`, que apagaria os outros quatro tipos junto). O caminho
   * real são duas fases, e é isso que devolvemos, nunca um atalho que faria
   * mais do que foi pedido.
   */
  buildDangerStatement(kind: 'truncate' | 'drop', table: string): string {
    const redisType = redisTypeForTable(table)
    const acao = kind === 'truncate' ? 'Esvaziar' : 'Apagar'
    return [
      `# ${acao} a pseudo-tabela "${table}" não é uma sentença atômica no Redis —`,
      '# não existe "TRUNCATE só do tipo hash". É sempre em duas fases:',
      '#',
      `#   1) SCAN 0 MATCH * COUNT 200 TYPE ${redisType}   (repita com o cursor devolvido até ele voltar a 0)`,
      '#   2) DEL <cada chave encontrada>',
      '#',
      '# Isto NÃO é FLUSHDB: chaves de outro tipo, ou fora do padrão, não são tocadas.'
    ].join('\n')
  }

  /**
   * Cancelamento cooperativo, não abortivo.
   *
   * O Redis não tem um "KILL QUERY" para um comando específico: cada comando
   * roda de forma atômica no servidor e volta rápido demais para interromper
   * no meio — diferente de uma query SQL que pode varrer milhões de linhas.
   * O que dá para cancelar de verdade é a navegação de pseudo-tabela e a
   * exportação, que são varreduras em página feitas por este processo: elas
   * conferem esta marca entre páginas de `SCAN` e param cedo. Um único
   * comando em voo (um `GET`, um `SET`) segue até o fim de qualquer forma.
   */
  async cancel(queryId: string): Promise<void> {
    this.cancelled.add(queryId)
  }

  private async *scanKeys(redisType: string, pattern: string): AsyncGenerator<string> {
    const client = this.require()
    let cursor = '0'
    do {
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200, 'TYPE', redisType)
      cursor = next
      for (const key of keys) yield key
    } while (cursor !== '0')
  }

  /** Lê o valor inteiro de uma chave na forma que a pseudo-tabela promete para a coluna `value`. */
  private async readValue(key: string, redisType: string): Promise<unknown> {
    const client = this.require()
    switch (redisType) {
      case 'string':
        return client.get(key)
      case 'hash':
        return client.hgetall(key)
      case 'list':
        return client.lrange(key, 0, -1)
      case 'set':
        return client.smembers(key)
      case 'zset':
        return readSortedSet(client, key)
      default:
        return null
    }
  }

  private async readTtl(key: string): Promise<number | null> {
    const seconds = await this.require().ttl(key)
    // -2 = chave não existe (raça entre o SCAN e a leitura); -1 = sem expiração.
    return seconds >= 0 ? seconds : null
  }

  /**
   * Monta o grid de três colunas de uma pseudo-tabela: uma linha por chave,
   * `SCAN` com `TYPE` do tipo Redis certo e `MATCH` do padrão pedido — nunca
   * `KEYS *`, que bloqueia o servidor inteiro enquanto varre.
   */
  private async browsePseudoTable(
    table: PseudoTable,
    pattern: string,
    maxRows: number,
    queryId?: string
  ): Promise<{ columns: QueryColumn[]; rows: unknown[][]; rowCount: number; truncatedAt?: number }> {
    const redisType = TABLE_TO_REDIS_TYPE[table]
    const keys: string[] = []
    for await (const key of this.scanKeys(redisType, pattern)) {
      if (queryId && this.cancelled.has(queryId)) break
      keys.push(key)
      if (keys.length > maxRows) break
    }
    const truncated = keys.length > maxRows
    const pageKeys = truncated ? keys.slice(0, maxRows) : keys

    const rows = await mapWithConcurrency(pageKeys, 20, async (key) => {
      const [value, ttl] = await Promise.all([this.readValue(key, redisType), this.readTtl(key)])
      return [key, value, ttl]
    })

    const columns: QueryColumn[] = [
      { name: 'key', type: 'string' },
      { name: 'value', type: redisType === 'string' ? 'string' : 'json' },
      { name: 'ttl', type: 'number' }
    ]
    return { columns, rows, rowCount: rows.length, truncatedAt: truncated ? maxRows : undefined }
  }

  /**
   * Roda um comando cru contra o Redis.
   *
   * Preferimos o método nomeado do ioredis (`hgetall`, `smembers`…) quando
   * ele existe: é gerado a partir da lista real de comandos do servidor e
   * devolve a resposta já na forma certa (hash como objeto, por exemplo).
   * `call` genérico é o caminho de escape para comando que o ioredis não
   * conhece — módulo customizado, comando muito novo — e manda o texto cru
   * sem tentar interpretar.
   */
  private async executeRaw(command: string, args: string[]): Promise<unknown> {
    const client = this.require() as unknown as Record<string, unknown>
    const method = client[command.toLowerCase()]
    if (typeof method === 'function') {
      return (method as (...a: unknown[]) => Promise<unknown>).apply(client, args)
    }
    return this.require().call(command, ...args)
  }

  private toQueryResult(outcome: unknown, statement: string, durationMs: number): QueryResult {
    if (Array.isArray(outcome)) {
      const { columns, matrix } = toGrid(outcome.map((item) => ({ resultado: item })))
      return { columns, rows: matrix, rowCount: matrix.length, durationMs, statement }
    }
    if (outcome !== null && typeof outcome === 'object') {
      const { columns, matrix } = toGrid([outcome as Record<string, unknown>])
      return { columns, rows: matrix, rowCount: matrix.length, durationMs, statement }
    }
    const { columns, matrix } = toGrid([{ resultado: outcome }])
    return { columns, rows: matrix, rowCount: matrix.length, durationMs, statement }
  }

  async query(source: string, options: QueryOptions): Promise<QueryResult[]> {
    await this.ensureDatabase(options.database)
    this.cancelled.delete(options.queryId)
    const results: QueryResult[] = []

    for (const statement of splitStatements(source)) {
      const tokens = tokenizeRedisCommand(statement)
      if (tokens.length === 0) continue
      const command = tokens[0].toUpperCase()

      if (this.config?.readOnly && isRedisWrite(command)) {
        throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
      }

      const started = Date.now()

      // Convenção de navegação de pseudo-tabela — ver comentário no topo do arquivo.
      if (command === 'SCAN' && tokens[1] && isPseudoTableName(tokens[1])) {
        const table = tokens[1].toLowerCase() as PseudoTable
        const pattern = extractMatchPattern(tokens.slice(2)) ?? '*'
        const maxRows = options.maxRows ?? options.previewRows ?? PREVIEW_ROWS
        const resultado = await this.browsePseudoTable(table, pattern, maxRows, options.queryId)
        results.push({ ...resultado, durationMs: Date.now() - started, statement })
        continue
      }

      const outcome = await this.executeRaw(command, tokens.slice(1))
      results.push(this.toQueryResult(outcome, statement, Date.now() - started))
    }

    this.cancelled.delete(options.queryId)
    return results
  }

  /**
   * Exportação.
   *
   * Quando o comando segue a convenção de navegação de pseudo-tabela, o
   * `SCAN` já é um cursor de verdade: streamamos em blocos de
   * `LOTE_EXPORTACAO`, com memória constante — igual ao MySQL. Para um
   * comando avulso não há cursor natural (um `SMEMBERS` não pagina sozinho),
   * então caímos para rodar `query` inteiro e entregar um bloco só, com o
   * mesmo compromisso documentado no `mongodb.ts`.
   */
  async streamQuery(
    source: string,
    options: { database?: string },
    aoReceber: (bloco: { columns: string[]; rows: unknown[][] }) => Promise<void>
  ): Promise<void> {
    await this.ensureDatabase(options.database)
    const tokens = tokenizeRedisCommand(source.trim())
    const command = tokens[0]?.toUpperCase()

    if (command === 'SCAN' && tokens[1] && isPseudoTableName(tokens[1])) {
      const table = tokens[1].toLowerCase() as PseudoTable
      const pattern = extractMatchPattern(tokens.slice(2)) ?? '*'
      const redisType = TABLE_TO_REDIS_TYPE[table]
      const colunas = ['key', 'value', 'ttl']
      let bloco: unknown[][] = []
      for await (const key of this.scanKeys(redisType, pattern)) {
        const [value, ttl] = await Promise.all([this.readValue(key, redisType), this.readTtl(key)])
        bloco.push([key, value, ttl])
        if (bloco.length >= LOTE_EXPORTACAO_REDIS) {
          await aoReceber({ columns: colunas, rows: bloco })
          bloco = []
        }
      }
      if (bloco.length) await aoReceber({ columns: colunas, rows: bloco })
      return
    }

    if (this.config?.readOnly && command && isRedisWrite(command)) {
      throw new Error(
        'A exportação só aceita comandos de leitura. Este comando altera o banco e não produz resultado para gravar.'
      )
    }

    const [resultado] = await this.query(source, {
      queryId: `export_${Date.now()}`,
      database: options.database
    })
    if (resultado && resultado.columns.length) {
      await aoReceber({ columns: resultado.columns.map((c) => c.name), rows: resultado.rows })
    }
  }

  /**
   * Reescreve a coluna `value` ou altera `ttl` de uma chave.
   *
   * O cuidado que importa: `SET chave valor` sozinho apaga o TTL existente
   * em silêncio. Sempre que esta função reescreve `value` de uma chave que já
   * tinha expiração, ela preserva essa expiração — via `KEEPTTL` na string, e
   * via `EXPIRE` reaplicado depois de reconstruir a estrutura nos demais
   * tipos, porque `DEL` sempre apaga o TTL e não existe `KEEPTTL` para
   * hash/list/set/zset. Só quem edita a coluna `ttl` para vazio é que
   * remove a expiração de propósito, com `PERSIST`.
   */
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
    await this.ensureDatabase(params.database)
    const redisType = redisTypeForTable(params.table)
    const chave = exigirChave(params.keys)
    const key = String(chave.find(([nome]) => nome === 'key')?.[1] ?? chave[0][1])
    const client = this.require()

    if (params.column === 'ttl') {
      if (params.value === null || params.value === undefined || params.value === '') {
        await client.persist(key)
        return { affectedRows: 1, statement: `PERSIST ${key}` }
      }
      const seconds = Number(params.value)
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('O TTL precisa ser um número de segundos maior que zero, ou vazio para remover a expiração.')
      }
      const inteiro = Math.floor(seconds)
      await client.expire(key, inteiro)
      return { affectedRows: 1, statement: `EXPIRE ${key} ${inteiro}` }
    }

    if (params.column !== 'value') {
      throw new Error(`Coluna "${params.column}" não é editável — só "value" e "ttl".`)
    }
    if (params.value === null || params.value === undefined) {
      throw new Error('O valor não pode ficar vazio. Para remover a chave, exclua a linha.')
    }

    const ttlAntes = await client.ttl(key)

    if (redisType === 'string') {
      const texto = typeof params.value === 'string' ? params.value : String(params.value)
      if (ttlAntes > 0) await client.call('SET', key, texto, KEEPTTL)
      else await client.set(key, texto)
      return { affectedRows: 1, statement: `SET ${key} ... ${ttlAntes > 0 ? KEEPTTL : ''}`.trim() }
    }

    // Hash, list, set e sorted set não têm um "SET" atômico para o valor
    // inteiro — a forma robusta é apagar e reconstruir dentro de uma
    // transação, o que por si só derrubaria o TTL, daí reaplicá-lo por
    // último, ainda dentro da mesma transação.
    const estrutura = parseJsonValue(params.value, params.table)
    const pipeline = client.multi()
    pipeline.call('DEL', key)
    pushRebuild(pipeline, redisType, key, estrutura)
    if (ttlAntes > 0) pipeline.call('EXPIRE', key, ttlAntes)
    const executado = await pipeline.exec()
    throwOnPipelineError(executado)

    return { affectedRows: 1, statement: `(reescrita de "${key}" preservando TTL)` }
  }

  /**
   * Insere uma chave nova. `table` diz o tipo Redis; `values.key` é
   * obrigatório; `values.value` e `values.ttl` são opcionais — sem `value`
   * a chave nasce vazia (string vazia, ou hash/list/set/zset sem membro,
   * conforme o tipo aceitar).
   */
  async insertRow(params: {
    table: string
    database?: string
    values: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }> {
    if (this.config?.readOnly) {
      throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
    }
    await this.ensureDatabase(params.database)
    const redisType = redisTypeForTable(params.table)
    const key = params.values.key
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Informe a chave (coluna "key").')
    }
    const client = this.require()
    if (await client.exists(key)) {
      throw new Error(`A chave "${key}" já existe. Edite a linha em vez de inserir de novo.`)
    }

    const bruto = params.values.value
    if (redisType === 'string') {
      const texto = bruto === undefined || bruto === null ? '' : String(bruto)
      await client.set(key, texto)
    } else {
      const estrutura = parseJsonValue(bruto ?? defaultForType(redisType), params.table)
      const pipeline = client.multi()
      pushRebuild(pipeline, redisType, key, estrutura)
      const executado = await pipeline.exec()
      throwOnPipelineError(executado)
    }

    const ttl = params.values.ttl
    if (ttl !== undefined && ttl !== null && ttl !== '') {
      const segundos = Number(ttl)
      if (Number.isFinite(segundos) && segundos > 0) {
        await client.expire(key, Math.floor(segundos))
      }
    }

    return { affectedRows: 1, statement: `(inserção de "${key}" em "${params.table}")` }
  }

  async deleteRow(params: {
    table: string
    database?: string
    keys: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }> {
    if (this.config?.readOnly) {
      throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
    }
    await this.ensureDatabase(params.database)
    const chave = exigirChave(params.keys)
    const key = String(chave.find(([nome]) => nome === 'key')?.[1] ?? chave[0][1])
    const removidas = await this.require().del(key)
    return { affectedRows: removidas, statement: `DEL ${key}` }
  }
}

/**
 * Linhas por bloco na exportação de pseudo-tabela em fluxo.
 *
 * Mesmo raciocínio do `LOTE_EXPORTACAO` do `types.ts`: grande o bastante para
 * não pagar uma ida ao Redis a cada punhado de chaves, pequeno o bastante
 * para a memória do processo ficar constante durante a exportação inteira.
 */
const LOTE_EXPORTACAO_REDIS = 5_000

/** Interpreta o JSON que o editor de célula manda para hash/list/set/sorted-set. */
function parseJsonValue(raw: unknown, contexto: string): unknown {
  if (typeof raw !== 'string') {
    throw new Error(`Valor inválido para "${contexto}": esperado um texto JSON.`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`O valor de "${contexto}" não é um JSON válido.`)
  }
}

function defaultForType(redisType: string): string {
  return redisType === 'hash' ? '{}' : '[]'
}

/**
 * `ZRANGE key 0 -1 WITHSCORES` via `call()` devolve `[[membro, nota], ...]`
 * já pareado nesta versão do ioredis — verificado contra um Redis 7 real, não
 * só na documentação. Sem esse cuidado, o código antigo assumia uma lista
 * achatada (`[membro, nota, membro, nota, ...]`), e o resultado saía com o
 * `member` sendo o par inteiro e o `score` virando `NaN` — silencioso o
 * bastante para passar batido se o teste só checasse "veio alguma coisa".
 * Trata os dois formatos por segurança, caso outra versão do cliente ou do
 * servidor devolva achatado.
 */
async function readSortedSet(
  client: Redis,
  key: string
): Promise<Array<{ member: string; score: number }>> {
  const raw = (await client.call('ZRANGE', key, '0', '-1', 'WITHSCORES')) as unknown[]
  const out: Array<{ member: string; score: number }> = []
  if (raw.length > 0 && Array.isArray(raw[0])) {
    for (const par of raw as Array<[string, string]>) {
      out.push({ member: par[0], score: Number(par[1]) })
    }
  } else {
    for (let i = 0; i < raw.length; i += 2) {
      out.push({ member: raw[i] as string, score: Number(raw[i + 1]) })
    }
  }
  return out
}

/** Membro de lista/set precisa ser texto — número ou objeto viram JSON. */
function stringifyMember(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Empilha, dentro de um `multi()`, os comandos que reconstroem a estrutura
 * a partir do JSON já interpretado. Usa `call` puro em vez dos métodos
 * tipados do ioredis: os métodos tipados têm dezenas de sobrecargas para
 * `NX`/`GT`/`CH` e afins que não fazem sentido aqui e só atrapalhariam a
 * assinatura genérica desta função.
 */
function pushRebuild(
  pipeline: ChainableCommander,
  redisType: string,
  key: string,
  estrutura: unknown
): void {
  switch (redisType) {
    case 'hash': {
      if (typeof estrutura !== 'object' || estrutura === null || Array.isArray(estrutura)) {
        throw new Error('O valor de um hash precisa ser um objeto JSON — {"campo": "valor", ...}.')
      }
      const entradas = Object.entries(estrutura as Record<string, unknown>)
      if (entradas.length === 0) return
      const args: string[] = []
      for (const [campo, valor] of entradas) args.push(campo, stringifyMember(valor))
      pipeline.call('HSET', key, ...args)
      return
    }
    case 'list': {
      if (!Array.isArray(estrutura)) {
        throw new Error('O valor de uma lista precisa ser um array JSON — [...] na ordem desejada.')
      }
      if (estrutura.length === 0) return
      pipeline.call('RPUSH', key, ...estrutura.map(stringifyMember))
      return
    }
    case 'set': {
      if (!Array.isArray(estrutura)) {
        throw new Error('O valor de um set precisa ser um array JSON — [...] com os membros.')
      }
      if (estrutura.length === 0) return
      pipeline.call('SADD', key, ...estrutura.map(stringifyMember))
      return
    }
    case 'zset': {
      if (!Array.isArray(estrutura)) {
        throw new Error(
          'O valor de um sorted set precisa ser um array JSON — [{"member": "...", "score": 1}, ...].'
        )
      }
      if (estrutura.length === 0) return
      const args: string[] = []
      for (const item of estrutura) {
        if (typeof item !== 'object' || item === null || !('member' in item) || !('score' in item)) {
          throw new Error('Cada item do sorted set precisa ter "member" e "score".')
        }
        const { member, score } = item as { member: unknown; score: unknown }
        args.push(String(score), stringifyMember(member))
      }
      pipeline.call('ZADD', key, ...args)
      return
    }
    default:
      throw new Error(`Tipo Redis desconhecido: ${redisType}`)
  }
}

/**
 * `multi().exec()` não rejeita quando um comando individual falha dentro da
 * transação — cada item vem como `[erro, resultado]`. Sem checar isso, um
 * `HSET` com argumento ímpar falharia em silêncio e a linha pareceria gravada.
 */
function throwOnPipelineError(executado: Array<[Error | null, unknown]> | null): void {
  if (!executado) throw new Error('A transação Redis não retornou resultado (conexão perdida?).')
  for (const [erro] of executado) {
    if (erro) throw erro
  }
}

/** Roda `fn` sobre `items` com no máximo `limit` chamadas simultâneas. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
