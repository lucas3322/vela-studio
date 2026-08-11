import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

interface AppState {
  theme: ThemeMode
  /** Tema realmente aplicado — 'system' já resolvido. */
  resolvedTheme: 'light' | 'dark'
  sidebarVisible: boolean
  /**
   * Altura do editor de query, em pixels.
   *
   * Mora no store, não em `useState` do painel: com estado local ela voltava
   * ao padrão a cada troca de aba, desfazendo o ajuste que a pessoa acabou de
   * fazer arrastando.
   */
  editorHeight: number
  helpPanelVisible: boolean
  modal: 'connection' | 'history' | 'cheatsheet' | 'preferences' | 'update' | 'saveQuery' | null
  /** Conexão sendo editada no modal, se houver. */
  editingConnectionId: string | null
  toast: { message: string; tone: 'info' | 'success' | 'danger' } | null

  setTheme: (theme: ThemeMode) => void
  applySystemTheme: (theme: 'light' | 'dark') => void
  toggleSidebar: () => void
  setEditorHeight: (altura: number) => void
  toggleHelpPanel: () => void
  openModal: (modal: AppState['modal'], connectionId?: string) => void
  closeModal: () => void
  notify: (message: string, tone?: 'info' | 'success' | 'danger') => void
}

const STORAGE_KEY = 'vela.theme'
const ALTURA_KEY = 'vela.editorHeight'
const ALTURA_PADRAO = 260

function readStoredHeight(): number {
  const guardada = Number(localStorage.getItem(ALTURA_KEY))
  return Number.isFinite(guardada) && guardada >= 90 ? guardada : ALTURA_PADRAO
}

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(theme: ThemeMode): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

/** O atributo no <html> é o que as custom properties observam. */
function paint(resolved: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = resolved
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useAppStore = create<AppState>((set, get) => {
  const initialTheme = readStoredTheme()
  const initialResolved = resolve(initialTheme)
  paint(initialResolved)

  return {
    theme: initialTheme,
    resolvedTheme: initialResolved,
    sidebarVisible: true,
    editorHeight: readStoredHeight(),
    helpPanelVisible: false,
    modal: null,
    editingConnectionId: null,
    toast: null,

    setTheme: (theme) => {
      localStorage.setItem(STORAGE_KEY, theme)
      const resolved = resolve(theme)
      paint(resolved)
      void window.vela.app.setTheme(theme)
      set({ theme, resolvedTheme: resolved })
    },

    applySystemTheme: (systemTheme) => {
      if (get().theme !== 'system') return
      paint(systemTheme)
      set({ resolvedTheme: systemTheme })
    },

    toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

    setEditorHeight: (altura) => {
      localStorage.setItem(ALTURA_KEY, String(altura))
      set({ editorHeight: altura })
    },
    toggleHelpPanel: () => set((s) => ({ helpPanelVisible: !s.helpPanelVisible })),

    openModal: (modal, connectionId) => set({ modal, editingConnectionId: connectionId ?? null }),
    closeModal: () => set({ modal: null, editingConnectionId: null }),

    notify: (message, tone = 'info') => {
      clearTimeout(toastTimer)
      set({ toast: { message, tone } })
      toastTimer = setTimeout(() => set({ toast: null }), 4000)
    }
  }
})
