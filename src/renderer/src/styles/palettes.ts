/**
 * Paletas de acento da IDE.
 *
 * ## Por que não é um seletor de cor livre
 *
 * Trocar só o matiz quebra o contraste. A mesma claridade HSL produz
 * luminâncias muito diferentes entre tons: violeta a 42% é escuro e precisa de
 * tinta branca por cima; verde a 42% é claro e some contra o fundo branco.
 * Medindo os oito tons candidatos com as claridades fixas do tema, **só o
 * âmbar passava** — um seletor livre desfaria em um clique o acerto de
 * contraste do resto da interface.
 *
 * Então cada paleta aqui foi resolvida e conferida: acento com no mínimo 3:1
 * contra o fundo, texto de acento com 4.5:1, e a tinta sobre o acento com
 * 4.5:1. O que varia entre elas, além do matiz, é justamente **qual tinta**
 * fica legível em cima — e é por isso que ela é declarada, não deduzida.
 */

export interface Paleta {
  id: string
  nome: string
  /** Matiz e saturação, aplicados a `--accent-h` / `--accent-s`. */
  h: number
  s: number
  /**
   * Claridade do acento e do texto de acento, por tema.
   *
   * Não são as mesmas para todas as cores: verde a 42% já é claro demais
   * contra branco, violeta a 60% é escuro demais para tinta branca em cima.
   * Um teste conferiu cada combinação — ver `src/tests/palettes.test.ts`.
   */
  lClaro: number
  lTextoClaro: number
  lEscuro: number
  lTextoEscuro: number
  /** Cor do texto que fica POR CIMA do acento, por tema. */
  inkClaro: string
  inkEscuro: string
}

const TINTA_ESCURA_CLARO = '#1a1d23'
const TINTA_ESCURA_ESCURO = '#16181d'
const TINTA_CLARA = '#ffffff'

export const PALETAS: Paleta[] = [
  {
    id: 'ambar',
    nome: 'Âmbar',
    h: 38,
    s: 90,
    lClaro: 42,
    lTextoClaro: 33,
    lEscuro: 60,
    lTextoEscuro: 70,
    inkClaro: TINTA_ESCURA_CLARO,
    inkEscuro: TINTA_ESCURA_ESCURO
  },
  {
    id: 'azul',
    nome: 'Azul',
    h: 212,
    s: 78,
    lClaro: 42,
    lTextoClaro: 33,
    lEscuro: 60,
    lTextoEscuro: 70,
    inkClaro: TINTA_CLARA,
    inkEscuro: TINTA_ESCURA_ESCURO
  },
  {
    id: 'violeta',
    nome: 'Violeta',
    h: 272,
    s: 66,
    lClaro: 42,
    lTextoClaro: 33,
    lEscuro: 59,
    lTextoEscuro: 70,
    inkClaro: TINTA_CLARA,
    inkEscuro: TINTA_CLARA
  },
  {
    id: 'verde',
    nome: 'Verde',
    h: 152,
    s: 58,
    lClaro: 41,
    lTextoClaro: 33,
    lEscuro: 60,
    lTextoEscuro: 70,
    inkClaro: TINTA_ESCURA_CLARO,
    inkEscuro: TINTA_ESCURA_ESCURO
  },
  {
    id: 'rosa',
    nome: 'Rosa',
    h: 344,
    s: 70,
    lClaro: 42,
    lTextoClaro: 33,
    lEscuro: 60,
    lTextoEscuro: 70,
    inkClaro: TINTA_CLARA,
    inkEscuro: TINTA_ESCURA_ESCURO
  }
]

export const PALETA_PADRAO = 'ambar'

export function acharPaleta(id: string): Paleta {
  return PALETAS.find((p) => p.id === id) ?? PALETAS[0]
}

/**
 * Aplica a paleta ao documento.
 *
 * A tinta vai em duas variáveis separadas porque depende do tema, e o tema
 * pode mudar sem passar por aqui — o `tokens.css` escolhe qual das duas usar.
 */
export function aplicarPaleta(id: string): void {
  const paleta = acharPaleta(id)
  const raiz = document.documentElement.style
  raiz.setProperty('--accent-h', String(paleta.h))
  raiz.setProperty('--accent-s', `${paleta.s}%`)
  raiz.setProperty('--accent-l-claro', `${paleta.lClaro}%`)
  raiz.setProperty('--accent-text-l-claro', `${paleta.lTextoClaro}%`)
  raiz.setProperty('--accent-l-escuro', `${paleta.lEscuro}%`)
  raiz.setProperty('--accent-text-l-escuro', `${paleta.lTextoEscuro}%`)
  raiz.setProperty('--accent-ink-claro', paleta.inkClaro)
  raiz.setProperty('--accent-ink-escuro', paleta.inkEscuro)
}
