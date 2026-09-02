/**
 * Busca dentro do que a grade já carregou.
 *
 * ## O que ela é, e o que ela não é
 *
 * Procura **só nas linhas que estão na tela** — a página atual, não a tabela.
 * Isso precisa ficar dito na interface, porque a diferença é enorme: numa
 * tabela de 250 mil linhas com 100 carregadas, "não encontrado" aqui quer
 * dizer "não está nestas 100", e não "não existe no banco". Confundir os dois
 * é o mesmo erro que a exportação cometia.
 *
 * Quem quer procurar na tabela inteira usa o filtro, que vai ao banco.
 *
 * ## Coluna e valor na mesma caixa
 *
 * Digitar `company_name` acha a coluna; digitar `POLARTEC` acha a célula. Os
 * dois aparecem na mesma lista, marcados, porque quem procura raramente sabe
 * de antemém em qual das duas coisas o que ele lembra está guardado.
 */

export type TipoDeAchado = 'coluna' | 'celula'

export interface Achado {
  tipo: TipoDeAchado
  /** Índice da coluna, sempre presente: é para ela que a grade rola. */
  coluna: number
  /** Índice da linha. Ausente quando o achado é o nome de uma coluna. */
  linha?: number
  /** O texto que casou, para a lista mostrar. */
  texto: string
}

export interface PedidoDeBusca {
  termo: string
  colunas: string[]
  /** As linhas já carregadas, como a grade as tem. */
  linhas: unknown[][]
  /** Como a grade formata cada valor — a busca precisa ver o mesmo texto. */
  formatar: (valor: unknown) => string
  /** Teto de achados. Uma página de 1000 linhas × 84 colunas gera muita coisa. */
  maximo?: number
}

const MAXIMO_PADRAO = 500

/**
 * Todos os lugares onde o termo aparece, colunas primeiro.
 *
 * Colunas na frente de propósito: quem digita um nome de campo quer chegar
 * naquela coluna, e ela costuma estar fora da tela à direita. Enterrá-la
 * depois de trezentas células faria o recurso parecer não funcionar.
 */
export function procurarNaGrade({
  termo,
  colunas,
  linhas,
  formatar,
  maximo = MAXIMO_PADRAO
}: PedidoDeBusca): Achado[] {
  const alvo = termo.trim().toLowerCase()
  if (!alvo) return []

  const achados: Achado[] = []

  colunas.forEach((nome, indice) => {
    if (nome.toLowerCase().includes(alvo)) {
      achados.push({ tipo: 'coluna', coluna: indice, texto: nome })
    }
  })

  // Percorre por linha, não por coluna: é a ordem em que a pessoa lê a grade,
  // e é a ordem em que ela espera navegar com Enter.
  for (let linha = 0; linha < linhas.length && achados.length < maximo; linha++) {
    for (let coluna = 0; coluna < colunas.length; coluna++) {
      const texto = formatar(linhas[linha]?.[coluna])
      if (texto.toLowerCase().includes(alvo)) {
        achados.push({ tipo: 'celula', coluna, linha, texto })
        if (achados.length >= maximo) break
      }
    }
  }

  return achados
}

/** Avança ou volta na lista, dando a volta nas pontas. */
export function proximoAchado(atual: number, total: number, passo: 1 | -1): number {
  if (total === 0) return 0
  return (atual + passo + total) % total
}

/**
 * Descrição do que foi encontrado, para a barra de busca.
 *
 * Diz **onde** procurou, não só quantos achou. "0 de 0" numa tabela grande
 * seria lido como "esse valor não existe", quando a verdade é "não está nas
 * linhas carregadas".
 */
export function descreverBusca(
  achados: Achado[],
  indice: number,
  linhasCarregadas: number
): string {
  if (achados.length === 0) {
    return `nada nas ${linhasCarregadas.toLocaleString('pt-BR')} linhas carregadas`
  }
  const colunas = achados.filter((a) => a.tipo === 'coluna').length
  const celulas = achados.length - colunas
  const partes: string[] = [`${indice + 1} de ${achados.length}`]
  if (colunas > 0) partes.push(`${colunas} coluna${colunas > 1 ? 's' : ''}`)
  if (celulas > 0) partes.push(`${celulas} célula${celulas > 1 ? 's' : ''}`)
  return partes.join(' · ')
}
