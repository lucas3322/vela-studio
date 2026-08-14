/**
 * Contraste de cada uso de `--text-tertiary` contra a superfície onde ele
 * realmente vive, nos dois temas.
 *
 * Existe porque o terciário é o token mais fácil de errar: ele é definido uma
 * vez e usado sobre cinco superfícies diferentes, e cada `:hover` clareia o
 * fundo justo enquanto a pessoa lê. Medir só contra `--bg-app` dá um número
 * bonito e falso — foi assim que ele ficou a 3.14:1 sobre `--bg-elevated` sem
 * ninguém notar.
 *
 * Diferente do `palettes.test.ts`, aqui os valores não são copiados: o teste
 * lê `tokens.css`. Se alguém escurecer um token, este arquivo passa a medir a
 * cor nova — que é o ponto.
 *
 * O que ele NÃO faz: descobrir sozinho qual superfície fica atrás de cada
 * seletor. Isso é a tabela `USOS` abaixo, escrita à mão a partir do CSS e dos
 * componentes. A guarda de cobertura no fim garante que ela não fique para
 * trás: um uso novo de `--text-tertiary` reprova até ser registrado aqui.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

type RGB = [number, number, number]
type RGBA = [number, number, number, number]

// ── WCAG 2.1 ────────────────────────────────────────────────────────────

function luminancia(cor: RGB): number {
  const canais = cor.map((v) => {
    const n = v / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2]
}

function razao(a: RGB, b: RGB): number {
  const l1 = luminancia(a)
  const l2 = luminancia(b)
  const [alto, baixo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (alto + 0.05) / (baixo + 0.05)
}

/** Compõe uma cor translúcida sobre um fundo opaco — é o que o `--bg-hover` faz. */
function sobre(base: RGB, camada: RGBA): RGB {
  const a = camada[3]
  return [0, 1, 2].map((i) => Math.round(camada[i] * a + base[i] * (1 - a))) as RGB
}

// ── Leitura de tokens.css ───────────────────────────────────────────────

const RAIZ = new URL('../renderer/src/', import.meta.url)

/* Comentários fora do caminho: o texto deles cita nomes de token e valores
   antigos, e um `#6e7783` de nota histórica não pode virar medição. */
const TOKENS_CSS = readFileSync(new URL('styles/tokens.css', RAIZ), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

const CORTE_CLARO = TOKENS_CSS.indexOf(":root[data-theme='light']")
assert.ok(CORTE_CLARO > 0, 'tokens.css não tem mais o bloco do tema claro')

function declaracao(bloco: string, nome: string): string {
  const achado = bloco.match(new RegExp(`\\${nome}:\\s*([^;]+);`))
  if (!achado) throw new Error(`token ${nome} não encontrado em tokens.css`)
  return achado[1].trim()
}

function corSolida(valor: string): RGB {
  const limpo = valor.replace('#', '')
  return [
    Number.parseInt(limpo.slice(0, 2), 16),
    Number.parseInt(limpo.slice(2, 4), 16),
    Number.parseInt(limpo.slice(4, 6), 16)
  ]
}

function corTranslucida(valor: string): RGBA {
  const partes = valor.match(/rgba?\(([^)]+)\)/)
  if (!partes) throw new Error(`esperava rgba() e veio "${valor}"`)
  const n = partes[1].split(',').map((p) => Number.parseFloat(p.trim()))
  return [n[0], n[1], n[2], n[3] ?? 1]
}

// ── Superfícies de cada tema ────────────────────────────────────────────

function lerTema(bloco: string): {
  fundos: Record<string, RGB>
  primary: RGB
  secondary: RGB
  tertiary: RGB
} {
  const solido = (nome: string): RGB => corSolida(declaracao(bloco, nome))
  const app = solido('--bg-app')
  const sidebar = solido('--bg-sidebar')
  const surface = solido('--bg-surface')
  const elevated = solido('--bg-elevated')
  const input = solido('--bg-input')
  const hover = corTranslucida(declaracao(bloco, '--bg-hover'))
  const danger = corTranslucida(declaracao(bloco, '--danger-subtle'))

  return {
    fundos: {
      'bg-input': input,
      'bg-app': app,
      'bg-app :hover': sobre(app, hover),
      'bg-sidebar': sidebar,
      'bg-sidebar :hover': sobre(sidebar, hover),
      'bg-surface': surface,
      'bg-surface :hover': sobre(surface, hover),
      'bg-elevated': elevated,
      'bg-elevated :hover': sobre(elevated, hover),
      // O painel de erro pinta `--danger-subtle` por cima da área de resultado.
      'painel de erro': sobre(app, danger)
    },
    primary: solido('--text-primary'),
    secondary: solido('--text-secondary'),
    tertiary: solido('--text-tertiary')
  }
}

const TEMAS = [
  { nome: 'escuro', ...lerTema(TOKENS_CSS.slice(0, CORTE_CLARO)) },
  { nome: 'claro', ...lerTema(TOKENS_CSS.slice(CORTE_CLARO)) }
] as const

// ── Inventário ──────────────────────────────────────────────────────────

/**
 * Cada uso de `--text-tertiary` no app, com a superfície que fica atrás dele.
 *
 * `fundos` lista todas as superfícies possíveis daquele ponto, não a mais
 * favorável: quando o `:hover` troca o fundo por baixo do texto, o estado
 * hovered entra na lista e é ele que costuma mandar no resultado.
 *
 * `tipo` decide o mínimo: `texto` precisa de 4.5:1, `interface` (ponto, ícone,
 * traço do diagrama) precisa de 3:1. Um ícone não é texto — mas continua
 * precisando ser percebido.
 */
type Uso = {
  seletor: string
  arquivo: string
  token: 'tertiary' | 'secondary'
  fundos: string[]
  tipo: 'texto' | 'interface'
}

const LAYOUT = 'styles/layout.css'
const GLOBAL = 'styles/global.css'

const USOS: Uso[] = [
  // ── barra lateral ─────────────────────────────────────────────────────
  { seletor: '.sidebar__connection-dot', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface'], tipo: 'interface' },
  { seletor: '.sidebar__connection-meta', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface'], tipo: 'texto' },
  { seletor: '.sidebar__search svg', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-input'], tipo: 'interface' },
  { seletor: '.sidebar__header', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.sidebar__modo', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.tree-node__chevron', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'interface' },
  { seletor: '.tree-node__icon--column', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'interface' },
  { seletor: '.tree-node__type', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'texto' },
  { seletor: '.tree-node__count', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'texto' },
  { seletor: '.tree-empty', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.salvas__escopo', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.salvas__meta', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'texto' },
  { seletor: '.modelo-lista__grau', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'texto' },

  // ── abas e editor ─────────────────────────────────────────────────────
  // A aba ativa troca o próprio fundo por `--bg-surface`; a inativa fica na
  // `--bg-sidebar` da barra de abas.
  { seletor: '.tab__kind--query', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-surface'], tipo: 'interface' },
  { seletor: '.tab__close', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-surface'], tipo: 'interface' },
  { seletor: '.editor-toolbar__hint', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface'], tipo: 'texto' },

  // ── grade e resultado ─────────────────────────────────────────────────
  { seletor: '.results__empty', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'texto' },
  { seletor: '.grid__th-type', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  // A linha sob o cursor troca o fundo do gutter por `--bg-surface`.
  { seletor: '.grid__gutter', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app', 'bg-surface'], tipo: 'texto' },
  { seletor: '.grid__truncated', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.paginacao__tamanho', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.filtro__juncao', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.data-table th', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'texto' },

  // ── erro e status ─────────────────────────────────────────────────────
  { seletor: '.error-panel__raw', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-input'], tipo: 'texto' },
  { seletor: '.error-panel__toggle', arquivo: LAYOUT, token: 'tertiary', fundos: ['painel de erro'], tipo: 'texto' },
  { seletor: '.statusbar__dot--off', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'interface' },
  { seletor: '.statusbar__item--acao', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },

  // ── painéis, modais, menu ─────────────────────────────────────────────
  { seletor: '.recipe__desc', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar', 'bg-sidebar :hover'], tipo: 'texto' },
  { seletor: '.recipe-category', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: '.context-menu__icon', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-elevated', 'bg-elevated :hover'], tipo: 'interface' },
  { seletor: '.campo-senha__olho', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-input'], tipo: 'interface' },

  // ── tela inicial ──────────────────────────────────────────────────────
  { seletor: '.welcome__version', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'texto' },
  { seletor: '.welcome__autor', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'texto' },
  // No `:hover` o cartão da conexão troca `--bg-surface` por `--bg-hover`,
  // que compõe sobre a `--bg-app` da tela inicial.
  { seletor: '.conexao__destino', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface', 'bg-app :hover'], tipo: 'texto' },

  // ── modelagem ─────────────────────────────────────────────────────────
  { seletor: '.modelo__linha', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'interface' },
  { seletor: '.modelo__linha--provavel', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'interface' },
  { seletor: '.modelo__ponta--palpite', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-app'], tipo: 'interface' },
  // Dentro do cartão: o corpo é `--bg-surface`, o cabeçalho é `--bg-elevated`,
  // e as duas marcas ficam abaixo do cabeçalho.
  { seletor: '.modelo__marca--fk', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface'], tipo: 'interface' },
  { seletor: '.modelo__resto', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-surface'], tipo: 'texto' },

  // ── aviso de versão nova ──────────────────────────────────────────────
  { seletor: '.aviso-versao__fechar', arquivo: LAYOUT, token: 'tertiary', fundos: ['bg-elevated'], tipo: 'interface' },

  // ── primitivos ────────────────────────────────────────────────────────
  { seletor: '.input::placeholder', arquivo: GLOBAL, token: 'tertiary', fundos: ['bg-input'], tipo: 'texto' },
  // O único `.btn--acento` do app fica na barra de paginação.
  { seletor: '.btn--acento:disabled', arquivo: GLOBAL, token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },

  // ── estilo inline em componentes ──────────────────────────────────────
  { seletor: 'HelpPanel · subtítulo', arquivo: 'components/HelpPanel.tsx', token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: 'Sidebar · chevron da conexão', arquivo: 'components/Sidebar.tsx', token: 'tertiary', fundos: ['bg-surface'], tipo: 'interface' },
  { seletor: 'Sidebar · "sem colunas carregadas"', arquivo: 'components/Sidebar.tsx', token: 'tertiary', fundos: ['bg-sidebar'], tipo: 'texto' },
  { seletor: 'TableView · comentário da coluna', arquivo: 'components/TableView.tsx', token: 'tertiary', fundos: ['bg-app'], tipo: 'texto' },
  { seletor: 'HistoryModal · lupa', arquivo: 'components/HistoryModal.tsx', token: 'tertiary', fundos: ['bg-elevated'], tipo: 'interface' },
  { seletor: 'CheatsheetModal · lupa', arquivo: 'components/CheatsheetModal.tsx', token: 'tertiary', fundos: ['bg-elevated'], tipo: 'interface' },

  // ── o que saiu do terciário ───────────────────────────────────────────
  /*
   * Estes eram terciário e agora são secundário. Continuam na tabela porque a
   * `--bg-elevated` é a superfície que motivou a troca: se alguém devolvê-los
   * ao terciário, o teste precisa reprovar em vez de ficar quieto.
   */
  { seletor: '.modal__subtitle', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated'], tipo: 'texto' },
  { seletor: '.driver-card__family', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated', 'bg-elevated :hover'], tipo: 'texto' },
  { seletor: '.history-item__meta', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated', 'bg-elevated :hover'], tipo: 'texto' },
  { seletor: '.context-menu__hint', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated', 'bg-elevated :hover'], tipo: 'texto' },
  { seletor: '.update__nota', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated'], tipo: 'texto' },
  { seletor: '.update__versao-meta', arquivo: LAYOUT, token: 'secondary', fundos: ['bg-elevated'], tipo: 'texto' },
  { seletor: '.field__hint', arquivo: GLOBAL, token: 'secondary', fundos: ['bg-elevated'], tipo: 'texto' }
]

const MIN_TEXTO = 4.5
const MIN_INTERFACE = 3.0

for (const tema of TEMAS) {
  for (const uso of USOS) {
    const minimo = uso.tipo === 'texto' ? MIN_TEXTO : MIN_INTERFACE
    test(`${tema.nome} · ${uso.seletor} (${uso.token})`, () => {
      const tinta = uso.token === 'tertiary' ? tema.tertiary : tema.secondary
      for (const nome of uso.fundos) {
        const fundo = tema.fundos[nome]
        assert.ok(fundo, `superfície desconhecida: ${nome}`)
        const r = razao(tinta, fundo)
        assert.ok(
          r >= minimo,
          `${uso.seletor} sobre ${nome}: ${r.toFixed(2)}:1, mínimo ${minimo} para ${uso.tipo}`
        )
      }
    })
  }
}

/**
 * A escala de texto tem que continuar sendo uma escala.
 *
 * O jeito preguiçoso de fazer os testes acima passarem é clarear o terciário
 * até ele encostar no secundário — aí o contraste fecha e a hierarquia some,
 * que é o problema que o terciário existe para resolver. Este teste é o outro
 * lado da pinça.
 */
const MIN_DEGRAU = 1.3

for (const tema of TEMAS) {
  test(`${tema.nome}: terciário ainda se separa do secundário`, () => {
    const r = razao(tema.tertiary, tema.secondary)
    assert.ok(r >= MIN_DEGRAU, `${r.toFixed(2)}:1, mínimo ${MIN_DEGRAU}`)
  })

  test(`${tema.nome}: secundário ainda se separa do primário`, () => {
    const r = razao(tema.secondary, tema.primary)
    assert.ok(r >= MIN_DEGRAU, `${r.toFixed(2)}:1, mínimo ${MIN_DEGRAU}`)
  })
}

/**
 * Guarda de cobertura.
 *
 * A tabela `USOS` é escrita à mão, então o risco real não é ela estar errada
 * hoje — é alguém acrescentar um `var(--text-tertiary)` amanhã sobre uma
 * superfície clara e o teste continuar verde porque não sabe que aquele uso
 * existe. Aqui o número de ocorrências no código tem que bater com o número de
 * linhas registradas.
 */
function arquivosDeUI(dir: URL): URL[] {
  const achados: URL[] = []
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const filho = new URL(`${item.name}${item.isDirectory() ? '/' : ''}`, dir)
    if (item.isDirectory()) achados.push(...arquivosDeUI(filho))
    else if (/\.(css|tsx|ts)$/.test(item.name) && item.name !== 'tokens.css') achados.push(filho)
  }
  return achados
}

test('todo uso de --text-tertiary está registrado na tabela', () => {
  const encontrados = new Map<string, number>()
  for (const arquivo of arquivosDeUI(RAIZ)) {
    const conteudo = readFileSync(arquivo, 'utf8')
    const n = conteudo.match(/var\(--text-tertiary\)/g)?.length ?? 0
    if (n > 0) encontrados.set(arquivo.pathname.split('/src/renderer/src/')[1], n)
  }

  const registrados = new Map<string, number>()
  for (const uso of USOS.filter((u) => u.token === 'tertiary')) {
    registrados.set(uso.arquivo, (registrados.get(uso.arquivo) ?? 0) + 1)
  }

  for (const [arquivo, n] of encontrados) {
    assert.equal(
      registrados.get(arquivo) ?? 0,
      n,
      `${arquivo} usa --text-tertiary ${n}×, mas a tabela USOS registra ${registrados.get(arquivo) ?? 0}. ` +
        `Todo uso novo precisa dizer sobre qual superfície ele fica.`
    )
  }

  for (const arquivo of registrados.keys()) {
    assert.ok(encontrados.has(arquivo), `USOS aponta para ${arquivo}, que não usa mais --text-tertiary`)
  }
})
