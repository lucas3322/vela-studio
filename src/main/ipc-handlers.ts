import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { ipcMain, dialog, nativeTheme, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  ColumnInfo,
  ConnectionConfig,
  QueryRunResult,
  TableInfo
} from '../shared/types'
import { ConnectionManager } from './connection-manager'
import { ConnectionStore } from './connection-store'
import { translateError } from './error-translator'
import { isUnboundedMutation, splitStatements } from './drivers/types'

export function registerIpcHandlers(manager: ConnectionManager, store: ConnectionStore): void {
  // ── Conexões ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.connectionsList, () => store.list())

  ipcMain.handle(
    IPC.connectionsSave,
    (_e, config: ConnectionConfig, savePassword: boolean) => store.save(config, savePassword)
  )

  ipcMain.handle(IPC.connectionsRemove, async (_e, id: string) => {
    await manager.close(id)
    store.remove(id)
  })

  ipcMain.handle(IPC.connectionsTest, (_e, config: ConnectionConfig) => manager.test(config))

  ipcMain.handle(IPC.connectionsOpen, async (_e, config: ConnectionConfig) => {
    // Conexão salva sem senha no payload: buscamos a cifrada no store.
    const resolved =
      config.password === undefined ? store.resolve(config.id) ?? config : config
    await manager.open(resolved)
    store.touch(config.id)
    const serverVersion = await manager.get(config.id).driver.serverVersion().catch(() => undefined)
    return { serverVersion }
  })

  ipcMain.handle(IPC.connectionsClose, (_e, id: string) => manager.close(id))

  // ── Schema ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.schemaDatabases, (_e, id: string) => manager.get(id).driver.listDatabases())

  ipcMain.handle(IPC.schemaTables, (_e, id: string, database?: string) =>
    manager.get(id).driver.listTables(database)
  )

  ipcMain.handle(IPC.schemaColumns, (_e, id: string, table: string, database?: string) =>
    manager.get(id).driver.listColumns(table, database)
  )

  ipcMain.handle(IPC.schemaIndexes, (_e, id: string, table: string, database?: string) =>
    manager.get(id).driver.listIndexes(table, database)
  )

  ipcMain.handle(IPC.schemaRelations, (_e, id: string, table: string, database?: string) =>
    manager.get(id).driver.listRelations(table, database)
  )

  /**
   * Carrega tabelas e colunas em lote. Em bancos grandes isso são centenas de
   * consultas ao information_schema; limitamos a concorrência pra não estourar
   * o pool nem deixar o servidor de joelhos.
   */
  ipcMain.handle(IPC.schemaLoadAll, async (_e, id: string, database?: string) => {
    const { driver } = manager.get(id)
    const tables = await driver.listTables(database)
    const columns: Record<string, ColumnInfo[]> = {}
    const CONCURRENCY = 6

    const queue = [...tables]
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const table = queue.shift() as TableInfo | undefined
        if (!table) break
        try {
          columns[table.name] = await driver.listColumns(table.name, database)
        } catch {
          // Uma tabela sem permissão não pode derrubar o carregamento inteiro.
          columns[table.name] = []
        }
      }
    })
    await Promise.all(workers)
    return { tables, columns }
  })

  ipcMain.handle(IPC.schemaCreateStatement, (_e, id: string, table: string, database?: string) =>
    manager.get(id).driver.getCreateStatement(table, database)
  )

  ipcMain.handle(
    IPC.schemaDangerStatement,
    (_e, id: string, kind: 'truncate' | 'drop', table: string) =>
      manager.get(id).driver.buildDangerStatement(kind, table)
  )

  // ── Query ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC.queryRun,
    async (
      _e,
      params: {
        connectionId: string
        sql: string
        database?: string
        queryId: string
        maxRows?: number
      }
    ): Promise<QueryRunResult> => {
      const { driver, config } = manager.get(params.connectionId)
      const started = Date.now()

      try {
        if (config.readOnly && config.driver !== 'mongodb') {
          for (const statement of splitStatements(params.sql)) {
            if (isUnboundedMutation(statement)) {
              throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
            }
          }
        }

        const results = await driver.query(params.sql, {
          queryId: params.queryId,
          database: params.database,
          maxRows: params.maxRows
        })

        store.addHistory({
          id: randomUUID(),
          connectionId: params.connectionId,
          connectionName: config.name,
          database: params.database,
          sql: params.sql,
          ok: true,
          rowCount: results.reduce((sum, r) => sum + r.rowCount, 0),
          durationMs: Date.now() - started,
          executedAt: Date.now()
        })

        return { results }
      } catch (error) {
        // Sugestões de "você quis dizer" precisam do schema; buscamos só no erro.
        let knownTables: string[] = []
        let knownColumns: string[] = []
        try {
          const tables = await driver.listTables(params.database)
          knownTables = tables.map((t) => t.name)
          const referenced = findReferencedTable(params.sql, knownTables)
          if (referenced) {
            knownColumns = (await driver.listColumns(referenced, params.database)).map((c) => c.name)
          }
        } catch {
          // Sem schema disponível seguimos com a tradução genérica.
        }

        const translated = translateError(error, {
          driver: config.driver,
          knownTables,
          knownColumns
        })

        store.addHistory({
          id: randomUUID(),
          connectionId: params.connectionId,
          connectionName: config.name,
          database: params.database,
          sql: params.sql,
          ok: false,
          durationMs: Date.now() - started,
          executedAt: Date.now()
        })

        return { results: [], error: translated }
      }
    }
  )

  ipcMain.handle(IPC.queryCancel, (_e, connectionId: string, queryId: string) =>
    manager.get(connectionId).driver.cancel(queryId)
  )

  // ── Histórico ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.historyList, (_e, connectionId?: string) => store.listHistory(connectionId))
  ipcMain.handle(IPC.historyClear, () => store.clearHistory())

  // ── App ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.appTheme, (_e, theme: 'light' | 'dark' | 'system') => {
    nativeTheme.themeSource = theme
  })

  ipcMain.handle(
    IPC.appPickFile,
    async (event, filters?: { name: string; extensions: string[] }[]) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openFile'],
        filters: filters ?? [{ name: 'Banco SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }]
      })
      return result.canceled ? undefined : result.filePaths[0]
    }
  )

  ipcMain.handle(
    IPC.appExport,
    async (
      event,
      params: { format: 'csv' | 'json'; columns: string[]; rows: unknown[][]; suggestedName: string }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(window!, {
        defaultPath: `${params.suggestedName}.${params.format}`,
        filters: [{ name: params.format.toUpperCase(), extensions: [params.format] }]
      })
      if (result.canceled || !result.filePath) return undefined

      const content =
        params.format === 'json'
          ? JSON.stringify(
              params.rows.map((row) =>
                Object.fromEntries(params.columns.map((c, i) => [c, row[i]]))
              ),
              null,
              2
            )
          : toCsv(params.columns, params.rows)

      writeFileSync(result.filePath, content, 'utf-8')
      return result.filePath
    }
  )
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [columns.map(escape).join(',')]
  for (const row of rows) lines.push(row.map(escape).join(','))
  return lines.join('\n')
}

/** Acha a tabela do FROM/JOIN pra saber quais colunas oferecer como sugestão no erro. */
function findReferencedTable(sql: string, knownTables: string[]): string | undefined {
  const match = /\b(?:from|join|update|into)\s+[`"[]?([\w.]+)[`"\]]?/i.exec(sql)
  if (!match) return undefined
  const name = match[1].split('.').pop()!
  return knownTables.find((t) => t.toLowerCase() === name.toLowerCase())
}
