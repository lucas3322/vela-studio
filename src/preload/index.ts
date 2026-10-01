import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VelaApi } from '../shared/ipc'
import { semEmbrulhoDoIpc } from '../shared/ipc-erro'

/**
 * `ipcRenderer.invoke` com a mensagem de erro limpa.
 *
 * Sem isto, todo erro do main chegava como "Error invoking remote method
 * '<canal>': Error: …" — o main traduzia a mensagem para português e o
 * Electron colava o nome técnico do canal na frente. Um lugar só, para nenhum
 * canal novo esquecer.
 */
const invocar = (canal: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(canal, ...args).catch((erro: unknown) => {
    const limpo = new Error(semEmbrulhoDoIpc(erro instanceof Error ? erro.message : String(erro)))
    throw limpo
  })

/**
 * Única superfície que o renderer enxerga do Node.
 * Nada de expor `ipcRenderer` cru: cada método é uma porta específica,
 * então uma falha de XSS no renderer não vira execução arbitrária.
 */
const api: VelaApi = {
  connections: {
    list: () => invocar(IPC.connectionsList),
    save: (config, savePassword) => invocar(IPC.connectionsSave, config, savePassword),
    remove: (id) => invocar(IPC.connectionsRemove, id),
    test: (config) => invocar(IPC.connectionsTest, config),
    forgetSshHostKey: (id) => invocar(IPC.connectionsForgetSshHostKey, id),
    open: (config) => invocar(IPC.connectionsOpen, config),
    close: (id) => invocar(IPC.connectionsClose, id)
  },
  schema: {
    databases: (id) => invocar(IPC.schemaDatabases, id),
    tables: (id, database) => invocar(IPC.schemaTables, id, database),
    columns: (id, table, database) => invocar(IPC.schemaColumns, id, table, database),
    indexes: (id, table, database) => invocar(IPC.schemaIndexes, id, table, database),
    relations: (id, table, database) => invocar(IPC.schemaRelations, id, table, database),
    allRelations: (connectionId, database) =>
      invocar(IPC.schemaAllRelations, connectionId, database),
    loadAll: (id, database) => invocar(IPC.schemaLoadAll, id, database),
    createStatement: (id, table, database) =>
      invocar(IPC.schemaCreateStatement, id, table, database),
    dangerStatement: (id, kind, table) =>
      invocar(IPC.schemaDangerStatement, id, kind, table),
    alterColumnStatement: (params) => invocar(IPC.schemaAlterColumnStatement, params)
  },
  data: {
    updateCell: (params) => invocar(IPC.dataUpdateCell, params),
    deleteRow: (params) => invocar(IPC.dataDeleteRow, params),
    insertRow: (params) => invocar(IPC.dataInsertRow, params)
  },
  query: {
    run: (params) => invocar(IPC.queryRun, params),
    cancel: (connectionId, queryId) => invocar(IPC.queryCancel, connectionId, queryId)
  },
  history: {
    list: (connectionId) => invocar(IPC.historyList, connectionId),
    clear: () => invocar(IPC.historyClear)
  },
  saved: {
    list: (connectionId) => invocar(IPC.savedList, connectionId),
    save: (entrada) => invocar(IPC.savedSave, entrada),
    remove: (id) => invocar(IPC.savedRemove, id)
  },
  app: {
    setTheme: (theme) => invocar(IPC.appTheme, theme),
    pickFile: (filters, opcoes) => invocar(IPC.appPickFile, filters, opcoes),
    exportQuery: (params) => invocar(IPC.appExportQuery, params),
    exportResult: (params) => invocar(IPC.appExport, params),
    importPreview: (params) => invocar(IPC.appImportPreview, params),
    importRun: (params) => invocar(IPC.appImportRun, params),
    importCancel: (importId) => invocar(IPC.appImportCancel, importId),
    revealInFolder: (caminho) => invocar(IPC.appRevealInFolder, caminho),
    platform: process.platform
  },
  update: {
    check: () => invocar(IPC.updateCheck),
    download: () => invocar(IPC.updateDownload),
    openPage: () => invocar(IPC.updateOpenPage)
  }
}

/** Eventos vindos do main (menu nativo, mudança de tema do SO). */
const events = {
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    const allowed = channel.startsWith('menu:') || channel.startsWith('app:')
    if (!allowed) throw new Error(`Canal não permitido: ${channel}`)
    const handler = (_e: unknown, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

contextBridge.exposeInMainWorld('vela', api)
contextBridge.exposeInMainWorld('velaEvents', events)
