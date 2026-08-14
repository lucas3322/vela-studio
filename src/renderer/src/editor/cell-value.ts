/**
 * Conversão entre o valor que veio do banco e o texto que se edita.
 *
 * Mora aqui, e não dentro do componente da grade, por dois motivos: é lógica
 * pura e precisa de teste, e os dois caminhos de edição — a caixa na linha e a
 * janela — precisam concordar. Quando cada um fazia a sua conversão, eles
 * discordaram, e o erro só apareceu meses depois numa coluna JSON.
 */

/**
 * O valor da célula como texto editável.
 *
 * Coluna JSON chega do driver como **objeto já interpretado**, não como texto.
 * `String()` nele produz `"[object Object]"` — e isso não era só feio na tela:
 * confirmar a edição mandava essa string literal para o banco no lugar do
 * JSON. Numa coluna `json` o banco recusa e ao menos aparece um erro; numa
 * coluna de texto guardando JSON, ele aceita e o dado se perde em silêncio.
 *
 * Devolve JSON **compacto**, igual ao que está guardado. Reindentar aqui faria
 * a célula ser marcada como alterada só por ter sido aberta — a janela de
 * edição tem um botão para formatar quando a pessoa quiser.
 */
export function paraEdicao(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'object') return JSON.stringify(valor)
  return String(valor)
}

/**
 * Dois valores representam o mesmo dado, mesmo vindo em formatos diferentes.
 *
 * Numa coluna JSON o valor original é objeto e o editado é string: `===` nunca
 * casaria, e abrir a célula sem mexer em nada já a marcaria como alterada.
 */
export function mesmoValor(a: unknown, b: unknown): boolean {
  return a === b || paraEdicao(a) === paraEdicao(b)
}
