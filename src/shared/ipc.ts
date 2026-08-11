import type {
  ColumnInfo,
  ConnectionConfig,
  DeleteRowParams,
  EditCellParams,
  EditResult,
  HistoryEntry,
  IndexInfo,
  QueryRunResult,
  RelationInfo,
  StoredConnection,
  TableInfo,
  SavedQuery,
  TestResult,
  UpdateInfo
} from './types'

/**
 * Nomes de canal em um só lugar. Se um canal existe aqui e não no main,
 * o typecheck do preload quebra — que é exatamente o que queremos.
 */
export const IPC = {
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsRemove: 'connections:remove',
  connectionsTest: 'connections:test',
  connectionsOpen: 'connections:open',
  connectionsClose: 'connections:close',

  schemaDatabases: 'schema:databases',
  schemaTables: 'schema:tables',
  schemaColumns: 'schema:columns',
  schemaIndexes: 'schema:indexes',
  schemaRelations: 'schema:relations',
  schemaLoadAll: 'schema:loadAll',
  schemaCreateStatement: 'schema:createStatement',
  schemaDangerStatement: 'schema:dangerStatement',

  dataUpdateCell: 'data:updateCell',
  dataDeleteRow: 'data:deleteRow',

  queryRun: 'query:run',
  queryCancel: 'query:cancel',

  historyList: 'history:list',
  historyClear: 'history:clear',

  savedList: 'saved:list',
  savedSave: 'saved:save',
  savedRemove: 'saved:remove',

  appTheme: 'app:theme',
  appPickFile: 'app:pickFile',
  appExport: 'app:export',

  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateOpenPage: 'update:openPage'
} as const

/** Evento de progresso do download, emitido pelo main. */
export const UPDATE_PROGRESS_EVENT = 'app:updateProgress'

export interface VelaApi {
  connections: {
    list(): Promise<StoredConnection[]>
    save(config: ConnectionConfig, savePassword: boolean): Promise<StoredConnection>
    remove(id: string): Promise<void>
    test(config: ConnectionConfig): Promise<TestResult>
    open(config: ConnectionConfig): Promise<{ serverVersion?: string }>
    close(id: string): Promise<void>
  }
  schema: {
    databases(connectionId: string): Promise<string[]>
    tables(connectionId: string, database?: string): Promise<TableInfo[]>
    columns(connectionId: string, table: string, database?: string): Promise<ColumnInfo[]>
    indexes(connectionId: string, table: string, database?: string): Promise<IndexInfo[]>
    relations(connectionId: string, table: string, database?: string): Promise<RelationInfo[]>
    /** Tabelas + colunas de uma vez: é o que alimenta o autocomplete. */
    loadAll(
      connectionId: string,
      database?: string
    ): Promise<{ tables: TableInfo[]; columns: Record<string, ColumnInfo[]> }>
    /** DDL de criação da tabela, para o menu de contexto. */
    createStatement(connectionId: string, table: string, database?: string): Promise<string>
    /** Monta o SQL destrutivo sem executá-lo, para a UI mostrar antes de confirmar. */
    dangerStatement(
      connectionId: string,
      kind: 'truncate' | 'drop',
      table: string
    ): Promise<string>
  }
  /** Edição direta na grade de dados. */
  data: {
    updateCell(params: EditCellParams): Promise<EditResult>
    deleteRow(params: DeleteRowParams): Promise<EditResult>
  }
  query: {
    run(params: {
      connectionId: string
      sql: string
      database?: string
      queryId: string
      maxRows?: number
    }): Promise<QueryRunResult>
    cancel(connectionId: string, queryId: string): Promise<void>
  }
  history: {
    list(connectionId?: string): Promise<HistoryEntry[]>
    clear(): Promise<void>
  }
  /** Queries que o usuário guardou pelo nome. */
  saved: {
    list(connectionId?: string): Promise<SavedQuery[]>
    /** Com `id` de uma existente, atualiza; sem, cria. */
    save(entrada: Omit<SavedQuery, 'createdAt' | 'updatedAt'>): Promise<SavedQuery>
    remove(id: string): Promise<void>
  }
  app: {
    setTheme(theme: 'light' | 'dark' | 'system'): Promise<void>
    pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | undefined>
    exportResult(params: {
      format: 'csv' | 'json'
      columns: string[]
      rows: unknown[][]
      suggestedName: string
    }): Promise<string | undefined>
    platform: string
  }
  /** Atualização do próprio app. Ver src/main/updater.ts para o porquê do fluxo. */
  update: {
    check(): Promise<UpdateInfo>
    /**
     * Baixa o instalador da última checagem e o abre.
     * Sem parâmetro de propósito: a URL vem do que o main guardou, não do renderer.
     */
    download(): Promise<{ caminho: string }>
    openPage(): Promise<void>
  }
}
