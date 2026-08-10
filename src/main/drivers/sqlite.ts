import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type {
  ColumnInfo,
  ConnectionConfig,
  Dialect,
  IndexInfo,
  QueryResult,
  RelationInfo,
  TableInfo,
  TestResult
} from '../../shared/types'
import {
  DEFAULT_MAX_ROWS,
  isMutation,
  splitStatements,
  type DatabaseDriver,
  type QueryOptions
} from './types'
import { toGridFromArrays } from './value-types'

export class SQLiteDriver implements DatabaseDriver {
  readonly dialect: Dialect = 'sqlite'
  private db?: Database.Database
  private config?: ConnectionConfig

  async connect(config: ConnectionConfig): Promise<void> {
    if (!config.filePath) throw new Error('Informe o caminho do arquivo .db')
    if (!existsSync(config.filePath)) {
      throw new Error(`Arquivo não encontrado: ${config.filePath}`)
    }
    this.config = config
    this.db = new Database(config.filePath, { readonly: !!config.readOnly, fileMustExist: true })
    // WAL deixa leitura e escrita concorrentes; é o padrão sensato pra uso interativo.
    if (!config.readOnly) this.db.pragma('journal_mode = WAL')
  }

  async disconnect(): Promise<void> {
    this.db?.close()
    this.db = undefined
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const started = Date.now()
    try {
      if (!config.filePath) return { ok: false, message: 'Informe o caminho do arquivo .db' }
      if (!existsSync(config.filePath)) {
        return { ok: false, message: `Arquivo não encontrado: ${config.filePath}` }
      }
      const db = new Database(config.filePath, { readonly: true, fileMustExist: true })
      const version = db.prepare('SELECT sqlite_version() AS v').get() as { v: string }
      db.close()
      return {
        ok: true,
        message: 'Arquivo aberto com sucesso',
        serverVersion: version.v,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  async serverVersion(): Promise<string | undefined> {
    return (this.require().prepare('SELECT sqlite_version() AS v').get() as { v: string }).v
  }

  private require(): Database.Database {
    if (!this.db) throw new Error('Banco SQLite não aberto')
    return this.db
  }

  /** SQLite tem um arquivo = um banco. Devolvemos 'main' pra manter a UI uniforme. */
  async listDatabases(): Promise<string[]> {
    const rows = this.require().pragma('database_list') as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  async listTables(): Promise<TableInfo[]> {
    const rows = this.require()
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string; type: string }>
    return rows.map((r) => ({
      name: r.name,
      type: r.type === 'view' ? 'view' : 'table'
    }))
  }

  async listColumns(table: string): Promise<ColumnInfo[]> {
    const rows = this.require().pragma(`table_info(${quoteIdent(table)})`) as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>
    const fkColumns = new Set(
      (this.require().pragma(`foreign_key_list(${quoteIdent(table)})`) as Array<{ from: string }>)
        .map((f) => f.from)
    )
    return rows.map((r) => ({
      name: r.name,
      type: r.type || 'BLOB',
      nullable: r.notnull === 0,
      defaultValue: r.dflt_value,
      isPrimaryKey: r.pk > 0,
      isForeignKey: fkColumns.has(r.name)
    }))
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    const list = this.require().pragma(`index_list(${quoteIdent(table)})`) as Array<{
      name: string
      unique: number
      origin: string
    }>
    return list.map((idx) => {
      const cols = this.require().pragma(`index_info(${quoteIdent(idx.name)})`) as Array<{
        name: string
      }>
      return {
        name: idx.name,
        columns: cols.map((c) => c.name),
        unique: idx.unique === 1,
        primary: idx.origin === 'pk'
      }
    })
  }

  async listRelations(table: string): Promise<RelationInfo[]> {
    const rows = this.require().pragma(`foreign_key_list(${quoteIdent(table)})`) as Array<{
      id: number
      from: string
      table: string
      to: string
      on_delete: string
      on_update: string
    }>
    return rows.map((r) => ({
      constraintName: `fk_${table}_${r.id}`,
      column: r.from,
      referencedTable: r.table,
      referencedColumn: r.to,
      onDelete: r.on_delete,
      onUpdate: r.on_update
    }))
  }

  async getCreateStatement(table: string): Promise<string> {
    const row = this.require()
      .prepare('SELECT sql FROM sqlite_master WHERE name = ?')
      .get(table) as { sql: string } | undefined
    if (!row?.sql) return ''

    // O SQLite guarda o DDL exatamente como foi escrito. Anexamos os índices,
    // que ficam em linhas separadas do sqlite_master.
    const indexes = this.require()
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
      .all(table) as Array<{ sql: string }>

    return [`${row.sql};`, ...indexes.map((i) => `${i.sql};`)].join('\n\n')
  }

  buildDangerStatement(kind: 'truncate' | 'drop', table: string): string {
    // SQLite não tem TRUNCATE: DELETE sem WHERE é o equivalente,
    // e o otimizador o trata como truncate quando não há trigger.
    return kind === 'truncate'
      ? `DELETE FROM ${quoteIdent(table)};`
      : `DROP TABLE ${quoteIdent(table)};`
  }

  async query(sql: string, options: QueryOptions): Promise<QueryResult[]> {
    const db = this.require()
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
    const results: QueryResult[] = []

    for (const statement of splitStatements(sql)) {
      if (this.config?.readOnly && isMutation(statement)) {
        throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
      }
      const started = Date.now()
      const stmt = db.prepare(statement)
      if (stmt.reader) {
        // `.raw()` devolve arrays em vez de objetos: no formato de objeto,
        // `SELECT c.id, p.id` de um JOIN colapsaria as duas colunas em uma.
        const names = stmt.columns().map((c) => c.name)
        const rows = stmt.raw().all() as unknown[][]
        const truncated = rows.length > maxRows
        const { columns, matrix } = toGridFromArrays(
          names,
          truncated ? rows.slice(0, maxRows) : rows
        )
        results.push({
          columns,
          rows: matrix,
          rowCount: matrix.length,
          durationMs: Date.now() - started,
          statement,
          truncatedAt: truncated ? maxRows : undefined
        })
      } else {
        const info = stmt.run()
        results.push({
          columns: [],
          rows: [],
          rowCount: 0,
          affectedRows: info.changes,
          durationMs: Date.now() - started,
          statement
        })
      }
    }
    return results
  }

  /**
   * better-sqlite3 é síncrono: quando a query começa, o event loop já está bloqueado
   * e não há o que cancelar. Mantemos o método pra cumprir o contrato.
   */
  async cancel(): Promise<void> {}
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
