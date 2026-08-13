import { create } from 'zustand'
import type {
  ColumnInfo,
  ConnectionConfig,
  SchemaRelation,
  StoredConnection,
  TableInfo
} from '@shared/types'

export interface SchemaCache {
  tables: TableInfo[]
  columns: Record<string, ColumnInfo[]>
  loadedAt: number
  /**
   * Chaves estrangeiras do banco inteiro.
   *
   * Carregadas sob demanda, não junto do schema: quem nunca abre a modelagem
   * não deve pagar por elas. `undefined` significa "ainda não perguntamos" e
   * é diferente de `[]`, que significa "perguntamos e este banco não declara
   * nenhuma" — a tela precisa distinguir os dois para não dizer "sem relações"
   * enquanto ainda está carregando.
   */
  relations?: SchemaRelation[]
}

interface ConnectionState {
  saved: StoredConnection[]
  /** Conexão em uso agora. Só uma fica ativa por vez na UI. */
  activeId: string | null
  activeDatabase: string | null
  databases: string[]
  serverVersion?: string
  connecting: boolean
  /** Schema por `${connectionId}::${database}` — é a base do autocomplete. */
  schemas: Record<string, SchemaCache>
  loadingSchema: boolean
  loadingRelations: boolean

  refreshSaved: () => Promise<void>
  connect: (config: ConnectionConfig) => Promise<void>
  disconnect: () => Promise<void>
  selectDatabase: (database: string) => Promise<void>
  reloadSchema: () => Promise<void>
  /** Busca as FKs do banco atual, se ainda não estiverem em cache. */
  loadRelations: (forcar?: boolean) => Promise<void>
  removeConnection: (id: string) => Promise<void>

  activeConnection: () => StoredConnection | undefined
  currentSchema: () => SchemaCache | undefined
}

const schemaKey = (connectionId: string, database?: string | null): string =>
  `${connectionId}::${database ?? ''}`

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  saved: [],
  activeId: null,
  activeDatabase: null,
  databases: [],
  connecting: false,
  schemas: {},
  loadingSchema: false,
  loadingRelations: false,

  refreshSaved: async () => {
    set({ saved: await window.vela.connections.list() })
  },

  connect: async (config) => {
    set({ connecting: true })
    try {
      const { serverVersion } = await window.vela.connections.open(config)
      const databases = await window.vela.schema
        .databases(config.id)
        .catch((): string[] => [])

      // O `database` da conexão só vale se o driver de fato o listar. No
      // Postgres a lista é de schemas, e o campo guarda o nome do database —
      // usá-lo às cegas fazia o schema virar "lojinha", que não existe, e a
      // barra lateral aparecia vazia.
      const configurado = config.database?.trim()
      const database =
        configurado && databases.includes(configurado)
          ? configurado
          : databases[0] ?? configurado ?? null

      set({
        activeId: config.id,
        activeDatabase: database,
        databases,
        serverVersion,
        connecting: false
      })
      await get().refreshSaved()

      // O schema NÃO é esperado aqui, de propósito.
      //
      // `loadAll` faz uma consulta de colunas por tabela — em um banco com 200
      // tabelas são centenas de idas ao catálogo. Esperar por isso mantinha o
      // modal de conexão aberto e imóvel enquanto a interface atrás dele já
      // tinha mudado, o que parece travamento.
      //
      // A conexão está aberta neste ponto; a barra lateral tem o próprio
      // indicador ("Lendo estrutura do banco…") enquanto o resto chega.
      void get().reloadSchema()
    } catch (error) {
      set({ connecting: false })
      throw error
    }
  },

  disconnect: async () => {
    const { activeId } = get()
    if (!activeId) return
    await window.vela.connections.close(activeId)
    set({ activeId: null, activeDatabase: null, databases: [], serverVersion: undefined })
  },

  selectDatabase: async (database) => {
    set({ activeDatabase: database })
    await get().reloadSchema()
  },

  reloadSchema: async () => {
    const { activeId, activeDatabase } = get()
    if (!activeId) return
    set({ loadingSchema: true })
    try {
      const { tables, columns } = await window.vela.schema.loadAll(
        activeId,
        activeDatabase ?? undefined
      )
      set((state) => ({
        schemas: {
          ...state.schemas,
          // As relações são descartadas junto: elas descrevem o schema que
          // acabou de ser relido, e manter as antigas desenharia ligação para
          // tabela que pode nem existir mais.
          [schemaKey(activeId, activeDatabase)]: { tables, columns, loadedAt: Date.now() }
        },
        loadingSchema: false
      }))
    } catch {
      set({ loadingSchema: false })
    }
  },

  loadRelations: async (forcar = false) => {
    const { activeId, activeDatabase, schemas, loadingRelations } = get()
    if (!activeId || loadingRelations) return

    const chave = schemaKey(activeId, activeDatabase)
    if (!forcar && schemas[chave]?.relations) return

    set({ loadingRelations: true })
    try {
      const relations = await window.vela.schema.allRelations(
        activeId,
        activeDatabase ?? undefined
      )
      set((state) => {
        const atual = state.schemas[chave]
        // O schema pode ter sido recarregado enquanto isto viajava. Sem esta
        // guarda, escreveríamos relações de volta num cache já substituído.
        if (!atual) return { loadingRelations: false }
        return {
          schemas: { ...state.schemas, [chave]: { ...atual, relations } },
          loadingRelations: false
        }
      })
    } catch {
      set({ loadingRelations: false })
    }
  },

  removeConnection: async (id) => {
    await window.vela.connections.remove(id)
    if (get().activeId === id) set({ activeId: null, activeDatabase: null, databases: [] })
    await get().refreshSaved()
  },

  activeConnection: () => {
    const { saved, activeId } = get()
    return saved.find((c) => c.id === activeId)
  },

  currentSchema: () => {
    const { schemas, activeId, activeDatabase } = get()
    if (!activeId) return undefined
    return schemas[schemaKey(activeId, activeDatabase)]
  }
}))
