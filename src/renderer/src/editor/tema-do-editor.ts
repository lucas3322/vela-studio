import { acharPaleta, coresDoEditor, hslParaHex } from '../styles/palettes.ts'

/**
 * As cores dos balões do editor — a lista de autocomplete e o balão de ajuda.
 *
 * ## Por que isto existe separado do tema
 *
 * O tema do Monaco é declarado com `inherit: true`, então **toda cor que a
 * gente não escreve vem do tema base do VS Code**. E a cor do texto da linha
 * selecionada da lista de sugestões vem de uma corrente de heranças que
 * termina em branco puro:
 *
 * ```
 * editorSuggestWidget.selectedForeground
 *   → quickInputList.focusForeground
 *     → list.activeSelectionForeground   =  Color.white
 * ```
 *
 * No VS Code isso funciona porque a linha selecionada tem fundo azul forte. No
 * nosso tema claro o fundo da seleção é uma faixa clara — então o texto branco
 * ficava branco sobre quase-branco, e a sugestão em foco (a que o Enter
 * aceita) era a única ilegível da lista. No tema escuro o mesmo branco caía
 * sobre `#343b46` e parecia estar tudo bem.
 *
 * Herança silenciosa é falha silenciosa: nada no `defineThemes` dizia que
 * aquela cor estava sendo decidida em outro lugar. Aqui as cores são
 * declaradas — e medidas, em `src/tests/tema-do-editor.test.ts`.
 */

export interface CoresDoBalao {
  /** Fundo do balão. */
  fundo: string
  /** Texto das linhas não selecionadas. */
  texto: string
  /** Faixa da linha selecionada, já composta sobre o fundo. */
  selecaoFundo: string
  /** Texto da linha selecionada. */
  selecaoTexto: string
  /** Trecho que casou com o que foi digitado. */
  realce: string
  /** O mesmo trecho, na linha selecionada. */
  realceSelecionado: string
  borda: string
}

/**
 * Opacidade da faixa de seleção sobre o fundo do balão.
 *
 * Mais forte do que o `--bg-selected` da grade (14%) de propósito: na grade a
 * seleção também ganha um contorno de acento, e aqui a faixa é o único sinal
 * de qual linha o Enter aceita.
 */
const OPACIDADE_DA_FAIXA = 0.22

const MIN_CONTRASTE = 4.5

function luminancia(hex: string): number {
  const limpo = hex.replace('#', '')
  const canais = [0, 2, 4].map((i) => Number.parseInt(limpo.slice(i, i + 2), 16) / 255)
  const linear = canais.map((n) => (n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function razao(a: string, b: string): number {
  const [alto, baixo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (alto + 0.05) / (baixo + 0.05)
}

/**
 * A tinta de acento mais próxima do tom da paleta que ainda se lê sobre `fundo`.
 *
 * Existe porque a faixa de foco muda o chão debaixo do realce: o acento foi
 * resolvido para 4.5:1 contra a superfície do balão, e sobre a faixa ele
 * perde. Em vez de trocar a cor por outra qualquer — ou de enfraquecer a faixa
 * até o problema sumir —, aqui a claridade anda de 1 em 1 até fechar a conta.
 * O matiz é o da paleta escolhida do começo ao fim.
 */
function acentoLegivel(h: number, s: number, lInicial: number, fundo: string, passo: 1 | -1): string {
  let l = lInicial
  let cor = `#${hslParaHex(h, s, l)}`
  while (razao(cor, fundo) < MIN_CONTRASTE && l > 0 && l < 100) {
    l += passo
    cor = `#${hslParaHex(h, s, l)}`
  }
  return cor
}

/** Compõe uma cor translúcida sobre um fundo opaco — o Monaco não faz isso. */
function compor(fundo: string, tinta: string, alfa: number): string {
  const canais = (hex: string): number[] => {
    const limpo = hex.replace('#', '')
    return [0, 2, 4].map((i) => Number.parseInt(limpo.slice(i, i + 2), 16))
  }
  const base = canais(fundo)
  const cima = canais(tinta)
  const mistura = base.map((valor, i) => Math.round(cima[i] * alfa + valor * (1 - alfa)))
  return `#${mistura.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function coresDoBalao(tema: 'claro' | 'escuro', paletaId: string): CoresDoBalao {
  const paleta = acharPaleta(paletaId)
  const acento = coresDoEditor(paletaId)

  if (tema === 'escuro') {
    const selecaoFundo = '#343b46'
    return {
      fundo: '#262b33',
      texto: '#e8eaed',
      selecaoFundo,
      selecaoTexto: '#ffffff',
      realce: `#${acento.escuro}`,
      // A faixa é mais clara que o balão: o realce clareia junto.
      realceSelecionado: acentoLegivel(paleta.h, paleta.s, paleta.lTextoEscuro, selecaoFundo, 1),
      borda: '#343a44'
    }
  }

  // A faixa segue a paleta escolhida, como a seleção do resto da IDE: a
  // claridade 45 é a mesma do `--bg-selected`, e é resolvida por paleta porque
  // o mesmo número em matizes diferentes não dá a mesma luminância.
  const selecaoFundo = compor('#ffffff', `#${hslParaHex(paleta.h, paleta.s, 45)}`, OPACIDADE_DA_FAIXA)

  return {
    fundo: '#ffffff',
    texto: '#1a1d23',
    selecaoFundo,
    selecaoTexto: '#1a1d23',
    realce: `#${acento.claro}`,
    // A faixa é mais escura que o balão: o realce escurece junto.
    realceSelecionado: acentoLegivel(paleta.h, paleta.s, paleta.lTextoClaro, selecaoFundo, -1),
    borda: '#e2e5ea'
  }
}
