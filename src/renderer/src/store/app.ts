import { create } from 'zustand'
import { PALETA_PADRAO, aplicarPaleta } from '../styles/palettes'

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

  /**
   * Linhas trazidas por uma query que não declara LIMIT.
   *
   * O driver corta em 100 por padrão para não travar a IDE num `SELECT *` de
   * tabela grande. Quem sabe o que está fazendo pode subir isso.
   */
  limitePreview: number
  /** Tamanho inicial da página na aba de tabela. */
  tamanhoPaginaPadrao: number
  /**
   * A partir de quantas linhas o resultado vira um aviso de desempenho.
   *
   * Abaixo disso o corte continua sendo informado, só que discretamente: a
   * informação "faltam linhas" não pode sumir, ou você tira conclusão de dado
   * incompleto sem saber. O que muda é o volume do aviso, não a verdade dele.
   */
  limiteAviso: number
  /** Acento da interface. Ver `styles/palettes.ts` para o porquê da lista fechada. */
  paleta: string
  helpPanelVisible: boolean
  modal: 'connection' | 'history' | 'cheatsheet' | 'preferences' | 'update' | 'saveQuery' | null
  /** Conexão sendo editada no modal, se houver. */
  editingConnectionId: string | null
  toast: { message: string; tone: 'info' | 'success' | 'danger' } | null

  setTheme: (theme: ThemeMode) => void
  applySystemTheme: (theme: 'light' | 'dark') => void
  toggleSidebar: () => void
  setEditorHeight: (altura: number) => void
  setLimitePreview: (linhas: number) => void
  setTamanhoPaginaPadrao: (linhas: number) => void
  setLimiteAviso: (linhas: number) => void
  setPaleta: (id: string) => void
  toggleHelpPanel: () => void
  openModal: (modal: AppState['modal'], connectionId?: string) => void
  closeModal: () => void
  notify: (message: string, tone?: 'info' | 'success' | 'danger') => void
}

const STORAGE_KEY = 'vela.theme'
const ALTURA_KEY = 'vela.editorHeight'
const ALTURA_PADRAO = 260

const PREFS_KEY = 'vela.preferencias'

interface Preferencias {
  limitePreview: number
  tamanhoPaginaPadrao: number
  limiteAviso: number
  paleta: string
}

const PADROES: Preferencias = {
  limitePreview: 100,
  tamanhoPaginaPadrao: 100,
  limiteAviso: 10_000,
  paleta: PALETA_PADRAO
}

function readPrefs(): Preferencias {
  try {
    const cru = localStorage.getItem(PREFS_KEY)
    if (!cru) return PADROES
    const lido = JSON.parse(cru) as Partial<Preferencias>
    return {
      // Cada campo é validado à parte: um JSON antigo ou editado à mão não
      // pode fazer a IDE abrir com limite zero ou paleta inexistente.
      limitePreview: sanear(lido.limitePreview, 1, 100_000, PADROES.limitePreview),
      tamanhoPaginaPadrao: sanear(lido.tamanhoPaginaPadrao, 1, 10_000, PADROES.tamanhoPaginaPadrao),
      limiteAviso: sanear(lido.limiteAviso, 1, 1_000_000, PADROES.limiteAviso),
      paleta: typeof lido.paleta === 'string' ? lido.paleta : PADROES.paleta
    }
  } catch {
    return PADROES
  }
}

function sanear(valor: unknown, min: number, max: number, padrao: number): number {
  const n = Number(valor)
  if (!Number.isFinite(n)) return padrao
  return Math.min(max, Math.max(min, Math.round(n)))
}

function gravarPrefs(prefs: Preferencias): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

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

  const prefs = readPrefs()
  aplicarPaleta(prefs.paleta)

  return {
    theme: initialTheme,
    resolvedTheme: initialResolved,
    sidebarVisible: true,
    editorHeight: readStoredHeight(),
    limitePreview: prefs.limitePreview,
    tamanhoPaginaPadrao: prefs.tamanhoPaginaPadrao,
    limiteAviso: prefs.limiteAviso,
    paleta: prefs.paleta,
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

    setLimitePreview: (linhas) => {
      const valor = sanear(linhas, 1, 100_000, PADROES.limitePreview)
      set({ limitePreview: valor })
      gravarPrefs({ ...prefsAtuais(get), limitePreview: valor })
    },

    setTamanhoPaginaPadrao: (linhas) => {
      const valor = sanear(linhas, 1, 10_000, PADROES.tamanhoPaginaPadrao)
      set({ tamanhoPaginaPadrao: valor })
      gravarPrefs({ ...prefsAtuais(get), tamanhoPaginaPadrao: valor })
    },

    setLimiteAviso: (linhas) => {
      const valor = sanear(linhas, 1, 1_000_000, PADROES.limiteAviso)
      set({ limiteAviso: valor })
      gravarPrefs({ ...prefsAtuais(get), limiteAviso: valor })
    },

    setPaleta: (id) => {
      aplicarPaleta(id)
      set({ paleta: id })
      gravarPrefs({ ...prefsAtuais(get), paleta: id })
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

/** Fotografia das preferências atuais, para gravar sem repetir campo por campo. */
function prefsAtuais(get: () => AppState): Preferencias {
  const s = get()
  return {
    limitePreview: s.limitePreview,
    tamanhoPaginaPadrao: s.tamanhoPaginaPadrao,
    limiteAviso: s.limiteAviso,
    paleta: s.paleta
  }
}
