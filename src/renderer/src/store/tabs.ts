import { create } from 'zustand'
import type { QueryError, QueryResult } from '@shared/types'

export type TabKind = 'query' | 'table'

export interface Tab {
  id: string
  kind: TabKind
  title: string
  /** Conteúdo do editor — só em abas de query. */
  sql: string
  /**
   * Query salva de onde esta aba veio, se veio de uma.
   *
   * É o que faz o ⌘S atualizar em vez de criar uma cópia nova a cada save —
   * sem isso, editar e salvar três vezes deixaria três entradas quase iguais
   * na lista.
   */
  savedQueryId?: string
  /** Nome da tabela — só em abas de tabela. */
  table?: string
  /**
   * Painel em que a aba de tabela abre. "Ver dados" e "Ver estrutura" são
   * itens diferentes no menu de contexto; sem isto os dois caíam em "dados".
   */
  initialPanel?: 'dados' | 'colunas'
  /**
   * Conexão dona da aba. Definida na criação e nunca mais alterada:
   * é o que permite trocar de banco e reencontrar as abas de volta,
   * do jeito que estavam.
   */
  connectionId: string
  database: string | null
  results: QueryResult[]
  activeResultIndex: number
  error?: QueryError
  running: boolean
  /** Id da execução em curso, usado para cancelar. */
  queryId?: string
  dirty: boolean
}

interface TabState {
  tabs: Tab[]
  /** Aba ativa por conexão — cada banco lembra onde você parou. */
  activeByConnection: Record<string, string>

  openQueryTab: (options: {
    connectionId: string
    database?: string | null
    sql?: string
    title?: string
    savedQueryId?: string
  }) => string
  openTableTab: (options: {
    connectionId: string
    database?: string | null
    table: string
    initialPanel?: 'dados' | 'colunas'
  }) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
  /** Fecha todas as abas de uma conexão — usado ao desconectar. */
  closeConnectionTabs: (connectionId: string) => void

  tabsFor: (connectionId: string | null) => Tab[]
  activeTabFor: (connectionId: string | null) => Tab | undefined
}

let counter = 0
const newId = (): string => `tab_${Date.now()}_${++counter}`

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeByConnection: {},

  tabsFor: (connectionId) =>
    connectionId ? get().tabs.filter((t) => t.connectionId === connectionId) : [],

  activeTabFor: (connectionId) => {
    if (!connectionId) return undefined
    const activeId = get().activeByConnection[connectionId]
    const tabs = get().tabsFor(connectionId)
    return tabs.find((t) => t.id === activeId) ?? tabs[0]
  },

  openQueryTab: ({ connectionId, database, sql, title, savedQueryId }) => {
    const id = newId()
    const existing = get()
      .tabsFor(connectionId)
      .filter((t) => t.kind === 'query')
      .map((t) => Number(/#(\d+)/.exec(t.title)?.[1] ?? 0))

    const tab: Tab = {
      id,
      kind: 'query',
      // A numeração é por conexão: cada banco tem sua própria Query #1.
      title: title ?? `Query #${Math.max(0, ...existing) + 1}`,
      sql: sql ?? '',
      savedQueryId,
      connectionId,
      database: database ?? null,
      results: [],
      activeResultIndex: 0,
      running: false,
      dirty: false
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeByConnection: { ...state.activeByConnection, [connectionId]: id }
    }))
    return id
  },

  openTableTab: ({ connectionId, database, table, initialPanel }) => {
    // Reaproveita a aba se a tabela já estiver aberta nesta conexão — abrir
    // cinco vezes a mesma tabela é sempre acidente, nunca intenção.
    const existing = get()
      .tabsFor(connectionId)
      .find((t) => t.kind === 'table' && t.table === table && t.database === (database ?? null))

    if (existing) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === existing.id ? { ...t, initialPanel: initialPanel ?? t.initialPanel } : t
        ),
        activeByConnection: { ...state.activeByConnection, [connectionId]: existing.id }
      }))
      return existing.id
    }

    const id = newId()
    const tab: Tab = {
      id,
      kind: 'table',
      title: table,
      table,
      initialPanel,
      sql: '',
      connectionId,
      database: database ?? null,
      results: [],
      activeResultIndex: 0,
      running: false,
      dirty: false
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeByConnection: { ...state.activeByConnection, [connectionId]: id }
    }))
    return id
  },

  closeTab: (id) => {
    set((state) => {
      const closing = state.tabs.find((t) => t.id === id)
      if (!closing) return state

      const siblings = state.tabs.filter((t) => t.connectionId === closing.connectionId)
      const index = siblings.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      const activeByConnection = { ...state.activeByConnection }

      if (activeByConnection[closing.connectionId] === id) {
        // Ao fechar a aba ativa, foca a vizinha da esquerda — como no VS Code.
        const remaining = siblings.filter((t) => t.id !== id)
        const next = remaining[Math.max(0, index - 1)]
        if (next) activeByConnection[closing.connectionId] = next.id
        else delete activeByConnection[closing.connectionId]
      }

      return { tabs, activeByConnection }
    })
  },

  setActive: (id) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id)
      if (!tab) return state
      return {
        activeByConnection: { ...state.activeByConnection, [tab.connectionId]: id }
      }
    })
  },

  updateTab: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    })),

  closeConnectionTabs: (connectionId) =>
    set((state) => {
      const activeByConnection = { ...state.activeByConnection }
      delete activeByConnection[connectionId]
      return {
        tabs: state.tabs.filter((t) => t.connectionId !== connectionId),
        activeByConnection
      }
    })
}))
