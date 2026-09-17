/**
 * Quando a grade deve rolar até um achado — e quando não deve.
 *
 * ## O bug que originou isto
 *
 * Rolar é uma **ação**, mas quem a disparava era um efeito, e efeito roda a
 * cada mudança de dependência. Uma das dependências era a largura das colunas,
 * que muda a cada pixel enquanto a pessoa arrasta a borda de um cabeçalho: com
 * a busca aberta, a grade voltava para a coluna achada no meio do arrasto, e
 * redimensionar qualquer outra coluna ficava impossível.
 *
 * ## A regra
 *
 * Cada rolagem atende a um **pedido**, e pedido é o que a pessoa fez: abrir a
 * busca, mudar o termo, apertar ↵/⇧↵, escolher uma coluna no filtro. O mesmo
 * pedido é atendido uma vez só — o efeito pode rodar quantas vezes quiser
 * depois, que ele não mexe mais na rolagem.
 *
 * Por isso a chave do pedido **não pode conter nada de layout**: largura,
 * posição, rolagem atual. Se contiver, cada pixel de arrasto vira um pedido
 * novo e o bug volta.
 */

/**
 * O pedido da busca (⌘F).
 *
 * `sequencia` é um contador que sobe a cada ação explícita — é ele que faz
 * apertar ↵ de novo levar de volta ao achado, mesmo sendo o mesmo achado.
 */
export function pedidoDaBusca(sequencia: number, indice: number): string {
  return `busca:${sequencia}:${indice}`
}

/** O pedido que vem de fora: a coluna escolhida na barra de filtro. */
export function pedidoDaEvidencia(coluna: string): string {
  return `evidencia:${coluna}`
}

/** Este pedido já foi atendido? */
export function deveNavegar(atendido: string | null, pedido: string): boolean {
  return atendido !== pedido
}
