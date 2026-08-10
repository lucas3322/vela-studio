/**
 * Contrato único entre main, preload e renderer.
 * Se um tipo atravessa o IPC, ele mora aqui.
 */

export type DriverId = 'mysql' | 'postgres' | 'sqlite' | 'mongodb'

/** Dialeto usado pelo editor para escolher keywords, funções e regras de citação. */
export type Dialect = 'mysql' | 'postgres' | 'sqlite' | 'mongodb'

export interface ConnectionConfig {
  id: string
  name: string
  driver: DriverId
  color?: string
  /** Host e porta — não usado por sqlite. */
  host?: string
  port?: number
  user?: string
  /** Nunca persistido em texto puro: o main criptografa com safeStorage. */
  password?: string
  database?: string
  /** Caminho do arquivo .db — só sqlite. */
  filePath?: string
  /** String de conexão completa — alternativa para mongodb e postgres. */
  connectionString?: string
  ssl?: boolean
  /** Bloqueia qualquer statement que escreva. */
  readOnly?: boolean
  createdAt?: number
  lastUsedAt?: number
}

/** O que fica salvo em disco: igual ao config, mas com a senha já cifrada. */
export interface StoredConnection extends Omit<ConnectionConfig, 'password'> {
  encryptedPassword?: string
  /**
   * Só na listagem enviada ao renderer. Diz se existe senha guardada sem
   * expor o texto cifrado — a UI precisa saber para pedir a senha antes de
   * tentar conectar, em vez de falhar com "Access denied" do banco.
   */
  hasPassword?: boolean
}

export interface TableInfo {
  name: string
  schema?: string
  /** Mongo usa 'collection'; SQL usa table/view. */
  type: 'table' | 'view' | 'collection'
  rowCount?: number
}

export interface ColumnInfo {
  name: string
  /** Tipo cru do banco: `varchar(255)`, `int`, `jsonb`, `ObjectId`… */
  type: string
  nullable: boolean
  defaultValue?: string | null
  isPrimaryKey: boolean
  isForeignKey?: boolean
  comment?: string | null
  extra?: string | null
  /** Só Mongo: em quantos % dos documentos amostrados o campo apareceu. */
  frequency?: number
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary?: boolean
}

export interface RelationInfo {
  constraintName: string
  column: string
  referencedTable: string
  referencedColumn: string
  onDelete?: string
  onUpdate?: string
}

export interface QueryColumn {
  name: string
  /** Tipo inferido para alinhamento e formatação no grid. */
  type: 'number' | 'string' | 'boolean' | 'date' | 'json' | 'binary' | 'null'
}

export interface QueryResult {
  /** Cada statement do lote vira um resultado. */
  columns: QueryColumn[]
  rows: unknown[][]
  rowCount: number
  affectedRows?: number
  /** Milissegundos medidos no main, incluindo ida e volta ao banco. */
  durationMs: number
  /** Preenchido quando a IDE cortou o resultado por segurança. */
  truncatedAt?: number
  /** Texto do statement que gerou esse resultado. */
  statement: string
}

export interface QueryError {
  /** Mensagem crua do driver — útil pra quem sabe o que está fazendo. */
  raw: string
  /** Mensagem reescrita em português, quando reconhecemos o código. */
  friendly: string
  /** Sugestão acionável: "você quis dizer `contracts`?" */
  hint?: string
  code?: string
  /** Posição 0-based no texto da query, quando o banco informa. */
  position?: number
}

export interface QueryRunResult {
  results: QueryResult[]
  error?: QueryError
}

export interface SchemaSnapshot {
  connectionId: string
  database: string
  tables: TableInfo[]
  /** Colunas por nome de tabela — o que alimenta o autocomplete. */
  columns: Record<string, ColumnInfo[]>
  loadedAt: number
}

export interface ConnectionStatus {
  connected: boolean
  connectionId?: string
  database?: string
  serverVersion?: string
  message?: string
}

export interface TestResult {
  ok: boolean
  message: string
  serverVersion?: string
  latencyMs?: number
}

/** Metadados de cada driver, usados pra montar o formulário de conexão. */
export interface DriverMeta {
  id: DriverId
  label: string
  dialect: Dialect
  defaultPort?: number
  family: 'sql' | 'nosql'
  /** Campos que o formulário deve mostrar. */
  fields: Array<'host' | 'port' | 'user' | 'password' | 'database' | 'filePath' | 'connectionString' | 'ssl'>
  accent: string
}

export const DRIVERS: Record<DriverId, DriverMeta> = {
  mysql: {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    dialect: 'mysql',
    defaultPort: 3306,
    family: 'sql',
    fields: ['host', 'port', 'user', 'password', 'database', 'ssl'],
    accent: '#00758f'
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    dialect: 'postgres',
    defaultPort: 5432,
    family: 'sql',
    fields: ['host', 'port', 'user', 'password', 'database', 'ssl', 'connectionString'],
    accent: '#336791'
  },
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    dialect: 'sqlite',
    family: 'sql',
    fields: ['filePath'],
    accent: '#0f80cc'
  },
  mongodb: {
    id: 'mongodb',
    label: 'MongoDB',
    dialect: 'mongodb',
    defaultPort: 27017,
    family: 'nosql',
    fields: ['connectionString', 'host', 'port', 'user', 'password', 'database'],
    accent: '#00ed64'
  }
}

export interface HistoryEntry {
  id: string
  connectionId: string
  connectionName: string
  database?: string
  sql: string
  ok: boolean
  rowCount?: number
  durationMs?: number
  executedAt: number
}
