import pg from 'pg'
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

// Por padrão o pg converte int8/numeric para string pra não perder precisão.
// Para exibição isso atrapalha o alinhamento; convertemos e aceitamos o risco em
// números acima de 2^53, que praticamente não aparecem como valor de coluna.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))

export class PostgresDriver implements DatabaseDriver {
  readonly dialect: Dialect = 'postgres'
  private pool?: pg.Pool
  private config?: ConnectionConfig
  private running = new Map<string, number>()

  private buildOptions(config: ConnectionConfig): pg.PoolConfig {
    if (config.connectionString?.trim()) {
      return {
        connectionString: config.connectionString.trim(),
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        max: 4,
        connectionTimeoutMillis: 15_000
      }
    }
    return {
      host: config.host || 'localhost',
      port: config.port || 5432,
      user: config.user,
      password: config.password,
      database: config.database || 'postgres',
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 4,
      connectionTimeoutMillis: 15_000
    }
  }

  async connect(config: ConnectionConfig): Promise<void> {
    this.config = config
    this.pool = new pg.Pool(this.buildOptions(config))
    const client = await this.pool.connect()
    client.release()
  }

  async disconnect(): Promise<void> {
    await this.pool?.end()
    this.pool = undefined
  }

  async testConnection(config: ConnectionConfig): Promise<TestResult> {
    const started = Date.now()
    const pool = new pg.Pool({ ...this.buildOptions(config), max: 1 })
    try {
      const res = await pool.query('SHOW server_version')
      return {
        ok: true,
        message: 'Conexão estabelecida',
        serverVersion: res.rows[0]?.server_version,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    } finally {
      await pool.end().catch(() => undefined)
    }
  }

  async serverVersion(): Promise<string | undefined> {
    const res = await this.require().query('SHOW server_version')
    return res.rows[0]?.server_version
  }

  private require(): pg.Pool {
    if (!this.pool) throw new Error('Conexão PostgreSQL não iniciada')
    return this.pool
  }

  async listDatabases(): Promise<string[]> {
    const res = await this.require().query(
      `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
    )
    return res.rows.map((r) => r.datname as string)
  }

  /**
   * No Postgres o análogo de "banco" na sidebar é o schema, não o database:
   * trocar de database exige reconectar, trocar de schema não.
   */
  async listTables(schema?: string): Promise<TableInfo[]> {
    const res = await this.require().query(
      `SELECT c.relname AS name, n.nspname AS schema,
              CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END AS type,
              c.reltuples::bigint AS row_estimate
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r','v','m','p')
         AND n.nspname = COALESCE($1, 'public')
       ORDER BY c.relname`,
      [schema ?? null]
    )
    return res.rows.map((r) => ({
      name: r.name as string,
      schema: r.schema as string,
      type: r.type as TableInfo['type'],
      rowCount: r.row_estimate < 0 ? undefined : Number(r.row_estimate)
    }))
  }

  async listSchemas(): Promise<string[]> {
    const res = await this.require().query(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
       ORDER BY nspname`
    )
    return res.rows.map((r) => r.nspname as string)
  }

  async listColumns(table: string, schema?: string): Promise<ColumnInfo[]> {
    const res = await this.require().query(
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS default_value,
              COALESCE(pk.is_pk, false) AS is_pk,
              COALESCE(fk.is_fk, false) AS is_fk,
              col_description(a.attrelid, a.attnum) AS comment
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       LEFT JOIN LATERAL (
         SELECT true AS is_pk FROM pg_constraint
         WHERE conrelid = c.oid AND contype = 'p' AND a.attnum = ANY(conkey) LIMIT 1
       ) pk ON true
       LEFT JOIN LATERAL (
         SELECT true AS is_fk FROM pg_constraint
         WHERE conrelid = c.oid AND contype = 'f' AND a.attnum = ANY(conkey) LIMIT 1
       ) fk ON true
       WHERE c.relname = $1 AND n.nspname = COALESCE($2, 'public')
         AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [table, schema ?? null]
    )
    return res.rows.map((r) => ({
      name: r.name as string,
      type: r.type as string,
      nullable: r.nullable as boolean,
      defaultValue: (r.default_value as string) ?? null,
      isPrimaryKey: r.is_pk as boolean,
      isForeignKey: r.is_fk as boolean,
      comment: (r.comment as string) ?? null
    }))
  }

  async listIndexes(table: string, schema?: string): Promise<IndexInfo[]> {
    const res = await this.require().query(
      `SELECT i.relname AS name,
              ix.indisunique AS unique,
              ix.indisprimary AS primary,
              array_agg(a.attname::text ORDER BY x.ord) AS columns
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
       WHERE t.relname = $1 AND n.nspname = COALESCE($2, 'public')
       GROUP BY i.relname, ix.indisunique, ix.indisprimary`,
      [table, schema ?? null]
    )
    return res.rows.map((r) => ({
      name: r.name as string,
      columns: r.columns as string[],
      unique: r.unique as boolean,
      primary: r.primary as boolean
    }))
  }

  async listRelations(table: string, schema?: string): Promise<RelationInfo[]> {
    const res = await this.require().query(
      `SELECT con.conname AS constraint_name,
              att.attname AS column_name,
              ref_cl.relname AS referenced_table,
              ref_att.attname AS referenced_column,
              con.confdeltype AS on_delete,
              con.confupdtype AS on_update
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = k.attnum
       JOIN pg_class ref_cl ON ref_cl.oid = con.confrelid
       JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
       JOIN pg_attribute ref_att ON ref_att.attrelid = ref_cl.oid AND ref_att.attnum = fk.attnum
       WHERE con.contype = 'f' AND cl.relname = $1 AND n.nspname = COALESCE($2, 'public')`,
      [table, schema ?? null]
    )
    const actions: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }
    return res.rows.map((r) => ({
      constraintName: r.constraint_name as string,
      column: r.column_name as string,
      referencedTable: r.referenced_table as string,
      referencedColumn: r.referenced_column as string,
      onDelete: actions[r.on_delete as string],
      onUpdate: actions[r.on_update as string]
    }))
  }

  /**
   * O PostgreSQL não tem `SHOW CREATE TABLE` — o `pg_dump` monta o DDL fora do
   * servidor. Reconstruímos a partir do catálogo, o que cobre o essencial
   * (colunas, tipos, default, NOT NULL, chaves e índices). Particionamento,
   * regras e triggers ficam de fora; o cabeçalho avisa disso.
   */
  async getCreateStatement(table: string, schema?: string): Promise<string> {
    const res = await this.require().query(
      `SELECT c.relkind AS kind, pg_get_viewdef(c.oid, true) AS view_def
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = COALESCE($2, 'public')`,
      [table, schema ?? null]
    )
    const kind = res.rows[0]?.kind as string | undefined
    if (!kind) return ''

    const qualified = `${quoteIdent(schema ?? 'public')}.${quoteIdent(table)}`

    if (kind === 'v' || kind === 'm') {
      const keyword = kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW'
      return `CREATE ${keyword} ${qualified} AS\n${res.rows[0].view_def}`
    }

    const [columns, indexes, relations] = await Promise.all([
      this.listColumns(table, schema),
      this.listIndexes(table, schema),
      this.listRelations(table, schema)
    ])

    const lines = columns.map((column) => {
      const parts = [`  ${quoteIdent(column.name)} ${column.type}`]
      if (!column.nullable) parts.push('NOT NULL')
      if (column.defaultValue) parts.push(`DEFAULT ${column.defaultValue}`)
      return parts.join(' ')
    })

    const primary = indexes.find((i) => i.primary)
    if (primary) {
      lines.push(`  PRIMARY KEY (${primary.columns.map(quoteIdent).join(', ')})`)
    }

    for (const relation of relations) {
      lines.push(
        `  CONSTRAINT ${quoteIdent(relation.constraintName)} FOREIGN KEY (${quoteIdent(relation.column)}) ` +
          `REFERENCES ${quoteIdent(relation.referencedTable)} (${quoteIdent(relation.referencedColumn)})` +
          (relation.onDelete && relation.onDelete !== 'NO ACTION' ? ` ON DELETE ${relation.onDelete}` : '') +
          (relation.onUpdate && relation.onUpdate !== 'NO ACTION' ? ` ON UPDATE ${relation.onUpdate}` : '')
      )
    }

    const statements = [
      '-- DDL reconstruído a partir do catálogo do PostgreSQL.',
      '-- Triggers, regras e particionamento não estão incluídos.',
      `CREATE TABLE ${qualified} (\n${lines.join(',\n')}\n);`
    ]

    for (const index of indexes) {
      if (index.primary) continue
      statements.push(
        `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdent(index.name)} ` +
          `ON ${qualified} (${index.columns.map(quoteIdent).join(', ')});`
      )
    }

    for (const column of columns) {
      if (column.comment) {
        statements.push(
          `COMMENT ON COLUMN ${qualified}.${quoteIdent(column.name)} IS ${quoteLiteral(column.comment)};`
        )
      }
    }

    return statements.join('\n\n')
  }

  buildDangerStatement(kind: 'truncate' | 'drop', table: string): string {
    return kind === 'truncate'
      ? `TRUNCATE TABLE ${quoteIdent(table)};`
      : `DROP TABLE ${quoteIdent(table)};`
  }

  async query(sql: string, options: QueryOptions): Promise<QueryResult[]> {
    const pool = this.require()
    const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
    const statements = splitStatements(sql)
    const results: QueryResult[] = []

    const client = await pool.connect()
    try {
      const pidRes = await client.query('SELECT pg_backend_pid() AS pid')
      this.running.set(options.queryId, Number(pidRes.rows[0].pid))

      if (options.database) {
        await client.query(`SET search_path TO "${options.database.replace(/"/g, '""')}", public`)
      }

      for (const statement of statements) {
        if (this.config?.readOnly && isMutation(statement)) {
          throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
        }
        const started = Date.now()
        const res = await client.query({ text: statement, rowMode: 'array' })
        const durationMs = Date.now() - started

        const fields = res.fields ?? []
        if (fields.length > 0) {
          const raw = res.rows as unknown[][]
          const truncated = raw.length > maxRows
          const sliced = truncated ? raw.slice(0, maxRows) : raw
          // Direto de array para grid: converter para objeto no meio do caminho
          // colapsaria colunas homônimas de um JOIN (`c.id` e `p.id`).
          const { columns, matrix } = toGridFromArrays(
            fields.map((f) => f.name),
            sliced
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
          results.push({
            columns: [],
            rows: [],
            rowCount: 0,
            affectedRows: res.rowCount ?? 0,
            durationMs,
            statement
          })
        }
      }
      return results
    } finally {
      this.running.delete(options.queryId)
      client.release()
    }
  }

  async cancel(queryId: string): Promise<void> {
    const pid = this.running.get(queryId)
    if (!pid || !this.pool) return
    await this.pool.query('SELECT pg_cancel_backend($1)', [pid]).catch(() => undefined)
  }
}

/** Aspas duplas delimitam identificador no Postgres; a aspa interna dobra. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Aspas simples delimitam literal de texto; a aspa interna dobra. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
