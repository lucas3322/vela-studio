/**
 * Onde o teclado está, para atalhos globais não roubarem tecla de quem digita.
 *
 * ## O que aconteceu
 *
 * A grade escuta `keydown` no `window` para tratar Enter, ⌘C e Escape sobre a
 * célula selecionada. Sem olhar o foco, isso vale **na tela inteira**: com uma
 * célula selecionada, apertar Enter dentro do editor de SQL abria o editor da
 * célula e chamava `preventDefault()` — a quebra de linha na consulta
 * simplesmente não acontecia. ⌘C copiava a célula no lugar do SQL selecionado.
 *
 * O sintoma que a pessoa descreve é outro: "preciso apertar Escape para
 * conseguir digitar". Escape limpa a seleção, o handler desiste, e o editor
 * volta a funcionar — o que esconde a causa.
 */

export interface AlvoDeFoco {
  tagName: string
  isContentEditable?: boolean
  /** O elemento está dentro de um editor de código (Monaco). */
  noEditorDeCodigo?: boolean
}

const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * A pessoa está digitando em algum campo?
 *
 * O Monaco põe o foco num `textarea` escondido, então a checagem por tag já o
 * cobre — mas a marca própria fica, porque depender de detalhe interno de
 * biblioteca é o tipo de coisa que quebra numa atualização, em silêncio.
 */
export function digitandoEmCampo(alvo: AlvoDeFoco | null | undefined): boolean {
  if (!alvo) return false
  if (alvo.noEditorDeCodigo) return true
  if (alvo.isContentEditable) return true
  return CAMPOS.has(alvo.tagName.toUpperCase())
}

/** Lê o alvo a partir do elemento com foco no documento. */
export function focoAtual(elemento: Element | null): AlvoDeFoco | null {
  if (!elemento) return null
  return {
    tagName: elemento.tagName,
    isContentEditable: (elemento as HTMLElement).isContentEditable,
    noEditorDeCodigo: Boolean(elemento.closest?.('.monaco-editor'))
  }
}
