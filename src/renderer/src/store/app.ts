import { create } from 'zustand'
import { PALETA_PADRAO, aplicarPaleta } from '../styles/palettes'
import { paletaEmVigor } from '../styles/connection-colors'

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
  /**
   * Acento **preferido**, escolhido nas Preferências e guardado em disco.
   * É o que vale quando a conexão aberta não tem cor própria.
   */
  paleta: string
  /**
   * Acento realmente aplicado agora.
   *
   * Deriva de duas fontes: a cor da conexão aberta manda; sem ela, vale a
   * preferência. Fica no store porque o editor Monaco também precisa segui-lo
   * — as regras de tema dele só aceitam hex literal, então ele redefine os
   * temas sempre que este valor muda. Sem um ponto único, a interface trocava
   * de cor e o editor ficava na anterior.
   */
  paletaEfetiva: string
  /** Cor da conexão aberta, lembrada para recalcular ao trocar a preferência. */
  corDaConexaoAberta: string | undefined
  /**
   * Se o diagrama deduz ligações que o banco não declara.
   *
   * `auto` é o padrão e olha o schema: banco sem nenhuma FK declarada liga a
   * inferência sozinho (senão o diagrama abriria vazio, afirmando que não há
   * relação nenhuma), e banco bem modelado a mantém desligada (senão
   * poluiríamos um mapa correto com palpite). `sim`/`nao` são a escolha
   * explícita da pessoa, que sempre vence.
   */
  inferirRelacoes: 'auto' | 'sim' | 'nao'
  helpPanelVisible: boolean
  modal: 'connection' | 'history' | 'cheatsheet' | 'preferences' | 'update' | 'saveQuery' | null
  /** Conexão sendo editada no modal, se houver. */
  editingConnectionId: string | null
  toast: { message: string; tone: 'info' | 'success' | 'danger' } | null
  /**
   * Comandos sem WHERE esperando confirmação, com o que fazer se ela vier.
   *
   * Vive no store porque a detecção acontece no `useRunQuery` e a confirmação
   * é uma tela — sem um ponto comum, cada caminho de execução precisaria da
   * sua própria cópia do diálogo.
   */
  confirmacaoDeEscrita: { comandos: string[]; aoConfirmar: () => void } | null
  /**
   * Alterações esperando confirmação, por aba.
   *
   * Mora no store porque quem tem as pendências (a grade de uma aba) e quem
   * precisa saber delas (a execução de query, em qualquer aba) não se
   * enxergam. Sem isto, rodar uma consulta descartava em silêncio o que a
   * pessoa tinha acabado de digitar noutra aba.
   */
  pendenciasDeEdicao: Record<string, number>
  /** Contador que manda as grades jogarem fora o que está pendente. */
  pedidoDeDescarte: number
  /** Pergunta pendente: descartar as edições para poder executar? */
  confirmacaoDeDescarte: { quantas: number; aoConfirmar: () => void } | null

  setTheme: (theme: ThemeMode) => void
  applySystemTheme: (theme: 'light' | 'dark') => void
  toggleSidebar: () => void
  setEditorHeight: (altura: number) => void
  setLimitePreview: (linhas: number) => void
  setTamanhoPaginaPadrao: (linhas: number) => void
  setLimiteAviso: (linhas: number) => void
  setPaleta: (id: string) => void
  /** Recalcula o acento a partir da cor da conexão aberta. */
  aplicarAcentoDaConexao: (corDaConexao: string | undefined) => void
  setInferirRelacoes: (valor: 'auto' | 'sim' | 'nao') => void
  toggleHelpPanel: () => void
  openModal: (modal: AppState['modal'], connectionId?: string) => void
  closeModal: () => void
  notify: (message: string, tone?: 'info' | 'success' | 'danger') => void
  pedirConfirmacaoDeEscrita: (comandos: string[], aoConfirmar: () => void) => void
  registrarPendencias: (abaId: string, quantas: number) => void
  descartarPendencias: () => void
  pedirDescarteDeEdicoes: (quantas: number, aoConfirmar: () => void) => void
  fecharDescarteDeEdicoes: () => void
  totalDePendencias: () => number
  fecharConfirmacaoDeEscrita: () => void
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
  inferirRelacoes: 'auto' | 'sim' | 'nao'
}

const PADROES: Preferencias = {
  limitePreview: 100,
  tamanhoPaginaPadrao: 100,
  limiteAviso: 10_000,
  paleta: PALETA_PADRAO,
  inferirRelacoes: 'auto'
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
      paleta: typeof lido.paleta === 'string' ? lido.paleta : PADROES.paleta,
      inferirRelacoes: ['auto', 'sim', 'nao'].includes(lido.inferirRelacoes as string)
        ? (lido.inferirRelacoes as Preferencias['inferirRelacoes'])
        : PADROES.inferirRelacoes
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
    paletaEfetiva: prefs.paleta,
    corDaConexaoAberta: undefined,
    inferirRelacoes: prefs.inferirRelacoes,
    helpPanelVisible: false,
    modal: null,
    editingConnectionId: null,
    toast: null,
    confirmacaoDeEscrita: null,
    pendenciasDeEdicao: {},
    pedidoDeDescarte: 0,
    confirmacaoDeDescarte: null,

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
      // Guarda a preferência e reaplica passando pela mesma regra: se a
      // conexão aberta tem cor, ela continua mandando, e trocar a preferência
      // aqui não deve arrancar a cor do banco debaixo dos pés.
      set({ paleta: id })
      gravarPrefs({ ...prefsAtuais(get), paleta: id })
      get().aplicarAcentoDaConexao(get().corDaConexaoAberta)
    },

    aplicarAcentoDaConexao: (corDaConexao) => {
      const emVigor = paletaEmVigor(corDaConexao, get().paleta)
      aplicarPaleta(emVigor)
      set({ paletaEfetiva: emVigor, corDaConexaoAberta: corDaConexao })
    },

    setInferirRelacoes: (valor) => {
      set({ inferirRelacoes: valor })
      gravarPrefs({ ...prefsAtuais(get), inferirRelacoes: valor })
    },
    toggleHelpPanel: () => set((s) => ({ helpPanelVisible: !s.helpPanelVisible })),

    openModal: (modal, connectionId) => set({ modal, editingConnectionId: connectionId ?? null }),
    closeModal: () => set({ modal: null, editingConnectionId: null }),

    pedirConfirmacaoDeEscrita: (comandos, aoConfirmar) =>
      set({ confirmacaoDeEscrita: { comandos, aoConfirmar } }),

    fecharConfirmacaoDeEscrita: () => set({ confirmacaoDeEscrita: null }),

    registrarPendencias: (abaId, quantas) =>
      set((estado) => {
        if ((estado.pendenciasDeEdicao[abaId] ?? 0) === quantas) return estado
        const proximo = { ...estado.pendenciasDeEdicao }
        // Zero não fica guardado: um mapa que só cresce faria o total contar
        // aba fechada e a IDE avisaria de alteração que não existe mais.
        if (quantas === 0) delete proximo[abaId]
        else proximo[abaId] = quantas
        return { pendenciasDeEdicao: proximo }
      }),

    pedirDescarteDeEdicoes: (quantas, aoConfirmar) =>
      set({ confirmacaoDeDescarte: { quantas, aoConfirmar } }),

    fecharDescarteDeEdicoes: () => set({ confirmacaoDeDescarte: null }),

    descartarPendencias: () =>
      set((estado) => ({
        pendenciasDeEdicao: {},
        pedidoDeDescarte: estado.pedidoDeDescarte + 1,
        confirmacaoDeDescarte: null
      })),

    totalDePendencias: () =>
      Object.values(get().pendenciasDeEdicao).reduce((soma, n) => soma + n, 0),

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
    paleta: s.paleta,
    inferirRelacoes: s.inferirRelacoes
  }
}
