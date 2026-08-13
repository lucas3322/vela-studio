import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type VelaApi } from '../shared/ipc'

/**
 * Única superfície que o renderer enxerga do Node.
 * Nada de expor `ipcRenderer` cru: cada método é uma porta específica,
 * então uma falha de XSS no renderer não vira execução arbitrária.
 */
const api: VelaApi = {
  connections: {
    list: () => ipcRenderer.invoke(IPC.connectionsList),
    save: (config, savePassword) => ipcRenderer.invoke(IPC.connectionsSave, config, savePassword),
    remove: (id) => ipcRenderer.invoke(IPC.connectionsRemove, id),
    test: (config) => ipcRenderer.invoke(IPC.connectionsTest, config),
    open: (config) => ipcRenderer.invoke(IPC.connectionsOpen, config),
    close: (id) => ipcRenderer.invoke(IPC.connectionsClose, id)
  },
  schema: {
    databases: (id) => ipcRenderer.invoke(IPC.schemaDatabases, id),
    tables: (id, database) => ipcRenderer.invoke(IPC.schemaTables, id, database),
    columns: (id, table, database) => ipcRenderer.invoke(IPC.schemaColumns, id, table, database),
    indexes: (id, table, database) => ipcRenderer.invoke(IPC.schemaIndexes, id, table, database),
    relations: (id, table, database) => ipcRenderer.invoke(IPC.schemaRelations, id, table, database),
    allRelations: (connectionId, database) =>
      ipcRenderer.invoke(IPC.schemaAllRelations, connectionId, database),
    loadAll: (id, database) => ipcRenderer.invoke(IPC.schemaLoadAll, id, database),
    createStatement: (id, table, database) =>
      ipcRenderer.invoke(IPC.schemaCreateStatement, id, table, database),
    dangerStatement: (id, kind, table) =>
      ipcRenderer.invoke(IPC.schemaDangerStatement, id, kind, table),
    alterColumnStatement: (params) => ipcRenderer.invoke(IPC.schemaAlterColumnStatement, params)
  },
  data: {
    updateCell: (params) => ipcRenderer.invoke(IPC.dataUpdateCell, params),
    deleteRow: (params) => ipcRenderer.invoke(IPC.dataDeleteRow, params)
  },
  query: {
    run: (params) => ipcRenderer.invoke(IPC.queryRun, params),
    cancel: (connectionId, queryId) => ipcRenderer.invoke(IPC.queryCancel, connectionId, queryId)
  },
  history: {
    list: (connectionId) => ipcRenderer.invoke(IPC.historyList, connectionId),
    clear: () => ipcRenderer.invoke(IPC.historyClear)
  },
  saved: {
    list: (connectionId) => ipcRenderer.invoke(IPC.savedList, connectionId),
    save: (entrada) => ipcRenderer.invoke(IPC.savedSave, entrada),
    remove: (id) => ipcRenderer.invoke(IPC.savedRemove, id)
  },
  app: {
    setTheme: (theme) => ipcRenderer.invoke(IPC.appTheme, theme),
    pickFile: (filters) => ipcRenderer.invoke(IPC.appPickFile, filters),
    exportResult: (params) => ipcRenderer.invoke(IPC.appExport, params),
    platform: process.platform
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    openPage: () => ipcRenderer.invoke(IPC.updateOpenPage)
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
