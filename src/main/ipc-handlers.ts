import { randomUUID } from 'node:crypto'
import { exportarEmFluxo } from './export-writer'
import { writeFileSync } from 'node:fs'
import { ipcMain, dialog, nativeTheme, BrowserWindow } from 'electron'
import { IPC, UPDATE_PROGRESS_EVENT , EXPORT_PROGRESS_EVENT } from '../shared/ipc'
import type {
  ColumnInfo,
  ConnectionConfig,
  InsertRowParams,
  QueryRunResult,
  TableInfo
} from '../shared/types'
import { ConnectionManager } from './connection-manager'
import { ConnectionStore } from './connection-store'
import { translateError } from './error-translator'
import { isMutation, splitStatements } from '../shared/sql-shape'
import { abrirArquivo, abrirPaginaDaRelease, baixarAtualizacao, verificarAtualizacao } from './updater'

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

  ipcMain.handle(IPC.connectionsTest, async (_e, config: ConnectionConfig) => {
    // Também resolve a senha guardada. Sem isto, "Testar" dentro do modal de
    // edição sempre falhava: o formulário abre com o campo de senha vazio de
    // propósito (a senha nunca vai para o renderer), então o teste ia ao banco
    // sem credencial nenhuma — enquanto conectar pela lista funcionava.
    const resultado = await manager.test(comSenhaGuardada(config, store))
    if (resultado.ok) return resultado
    // O driver devolve a mensagem crua; traduzimos aqui, onde sabemos o driver.
    const traduzido = translateError(new Error(resultado.message), { driver: config.driver })
    return {
      ...resultado,
      message: traduzido.hint ? `${traduzido.friendly} ${traduzido.hint}` : traduzido.friendly
    }
  })

  ipcMain.handle(IPC.connectionsOpen, async (_e, config: ConnectionConfig) => {
    const resolved = comSenhaGuardada(config, store)
    try {
      await manager.open(resolved)
    } catch (error) {
      // Sem isto o renderer recebe "Error invoking remote method
      // 'connections:open': Error: …" com a mensagem crua do driver dentro.
      const traduzido = translateError(error, { driver: config.driver })
      throw new Error(traduzido.hint ? `${traduzido.friendly} ${traduzido.hint}` : traduzido.friendly)
    }
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

  ipcMain.handle(IPC.schemaAllRelations, (_e, id: string, database?: string) =>
    manager.get(id).driver.listAllRelations(database)
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

  // ── Edição de dados ───────────────────────────────────────────────────
  //
  // Erros aqui chegam direto ao usuário no meio de uma edição, então são
  // traduzidos como qualquer outro erro de banco.
  ipcMain.handle(
    IPC.dataUpdateCell,
    async (
      _e,
      params: {
        connectionId: string
        table: string
        database?: string
        column: string
        value: unknown
        keys: Record<string, unknown>
      }
    ) => {
      const { driver, config } = manager.get(params.connectionId)
      try {
        return await driver.updateCell(params)
      } catch (error) {
        const t = translateError(error, { driver: config.driver })
        throw new Error(t.hint ? `${t.friendly} ${t.hint}` : t.friendly)
      }
    }
  )

  ipcMain.handle(
    IPC.dataDeleteRow,
    async (
      _e,
      params: {
        connectionId: string
        table: string
        database?: string
        keys: Record<string, unknown>
      }
    ) => {
      const { driver, config } = manager.get(params.connectionId)
      try {
        return await driver.deleteRow(params)
      } catch (error) {
        const t = translateError(error, { driver: config.driver })
        throw new Error(t.hint ? `${t.friendly} ${t.hint}` : t.friendly)
      }
    }
  )

  ipcMain.handle(IPC.dataInsertRow, async (_e, params: InsertRowParams) => {
    const { driver, config } = manager.get(params.connectionId)
    try {
      return await driver.insertRow({
        table: params.table,
        database: params.database,
        values: params.values
      })
    } catch (error) {
      // Mesma tradução dos irmãos: um "ER_NO_DEFAULT_FOR_FIELD" cru no meio de
      // um formulário não diz a ninguém qual campo faltou.
      const t = translateError(error, { driver: config.driver })
      throw new Error(t.hint ? `${t.friendly} ${t.hint}` : t.friendly)
    }
  })

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
        previewRows?: number
      }
    ): Promise<QueryRunResult> => {
      const { driver, config } = manager.get(params.connectionId)
      const started = Date.now()

      try {
        // `isMutation`, não `isUnboundedMutation`: em somente-leitura o que se
        // bloqueia é qualquer escrita. Com o predicado antigo, um
        // `UPDATE ... WHERE id = 1` passava por aqui — os drivers ainda
        // barravam, mas a checagem dizia outra coisa do que fazia.
        //
        // Mongo e Redis ficam de fora: `isMutation` reconhece a *forma* do
        // SQL (INSERT/UPDATE/DELETE…), e nenhum dos dois fala SQL. Sem essa
        // exclusão, todo comando dos dois passaria batido aqui — não porque
        // fosse seguro, mas porque a checagem estaria fazendo a pergunta
        // errada. A guarda de verdade para esses dois vive no próprio driver.
        if (config.readOnly && config.driver !== 'mongodb' && config.driver !== 'redis') {
          for (const statement of splitStatements(params.sql)) {
            if (isMutation(statement)) {
              throw new Error('Conexão em modo somente-leitura: comandos de escrita estão bloqueados.')
            }
          }
        }

        const results = await driver.query(params.sql, {
          queryId: params.queryId,
          database: params.database,
          maxRows: params.maxRows,
          previewRows: params.previewRows
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

  ipcMain.handle(
    IPC.appExportQuery,
    async (
      event,
      params: {
        connectionId: string
        sql: string
        database?: string
        format: 'csv' | 'json'
        suggestedName: string
      }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const escolha = await dialog.showSaveDialog(window!, {
        defaultPath: `${params.suggestedName}.${params.format}`,
        filters: [{ name: params.format.toUpperCase(), extensions: [params.format] }]
      })
      if (escolha.canceled || !escolha.filePath) return undefined

      const { driver } = manager.get(params.connectionId)
      return exportarEmFluxo({
        driver,
        sql: params.sql,
        database: params.database,
        format: params.format,
        caminho: escolha.filePath,
        aoProgredir: (linhas, arquivos) => {
          // Exportação de milhões de linhas leva minutos. Sem andamento, a
          // única leitura possível da tela é "travou".
          if (!event.sender.isDestroyed()) {
            event.sender.send(EXPORT_PROGRESS_EVENT, { linhas, arquivos })
          }
        }
      })
    }
  )

  ipcMain.handle(
    IPC.schemaAlterColumnStatement,
    async (
      _e,
      params: {
        connectionId: string
        table: string
        column: string
        newType: string
        database?: string
      }
    ) => {
      const { driver, config } = manager.get(params.connectionId)
      try {
        return await driver.buildAlterColumnTypeStatement(params)
      } catch (error) {
        const t = translateError(error, { driver: config.driver })
        throw new Error(t.hint ? `${t.friendly} ${t.hint}` : t.friendly)
      }
    }
  )

  // ── Queries salvas ────────────────────────────────────────────────────

  ipcMain.handle(IPC.savedList, (_e, connectionId?: string) =>
    store.listSavedQueries(connectionId)
  )
  ipcMain.handle(IPC.savedSave, (_e, entrada: Parameters<typeof store.saveQuery>[0]) =>
    store.saveQuery(entrada)
  )
  ipcMain.handle(IPC.savedRemove, (_e, id: string) => store.removeSavedQuery(id))

  // ── Atualização ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.updateCheck, () => verificarAtualizacao())

  ipcMain.handle(IPC.updateDownload, async (evento) => {
    const caminho = await baixarAtualizacao((progresso) => {
      // Manda para a janela que pediu, não para todas: com duas janelas abertas
      // um broadcast faria as duas mostrarem a mesma barra.
      if (!evento.sender.isDestroyed()) evento.sender.send(UPDATE_PROGRESS_EVENT, progresso)
    })
    await abrirArquivo(caminho)
    return { caminho }
  })

  ipcMain.handle(IPC.updateOpenPage, () => abrirPaginaDaRelease())
}

/**
 * Completa a configuração com a senha guardada, quando o renderer não mandou uma.
 *
 * O formulário de edição abre com o campo de senha **vazio** de propósito: a
 * senha cifrada nunca viaja para o renderer. Isso significa que "campo vazio"
 * quer dizer "não digitei", não "a senha é vazia".
 *
 * A versão anterior só cobria `undefined`, e o modal manda string vazia. O
 * efeito: editar uma conexão e clicar em Testar ou Conectar ia ao banco sem
 * credencial e voltava "Nenhuma senha foi enviada para o banco. Esta conexão
 * foi salva sem senha" — uma mensagem falsa, porque a senha estava salva; só
 * não tinha sido enviada. Conectar pela lista funcionava, o que fazia o defeito
 * parecer coisa de outro mundo.
 */
function comSenhaGuardada(config: ConnectionConfig, store: ConnectionStore): ConnectionConfig {
  if (config.password) return config
  const guardada = store.resolve(config.id)
  if (!guardada?.password) return config
  // Só a senha vem do disco: o resto é o que está no formulário agora, senão
  // uma edição de host ou de porta seria descartada ao testar.
  return { ...config, password: guardada.password }
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
