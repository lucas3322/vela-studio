import { extractTables } from './sql-context.ts'

/**
 * De qual tabela um resultado de consulta pode ser editado — ou por que não.
 *
 * Editar uma célula significa montar um `UPDATE tabela SET coluna = ? WHERE
 * chave = ?`. Para isso é preciso saber, sem chutar:
 *
 * - **de qual tabela** a linha veio;
 * - **qual linha** é, o que exige a chave primária no resultado;
 * - **qual coluna** do banco corresponde à coluna da tela.
 *
 * Numa aba de tabela as três respostas são conhecidas. Num resultado de
 * consulta, nem sempre — e é aí que mora o perigo. Um `JOIN` produz uma grade
 * que parece perfeitamente editável, mas a coluna `nome` pode vir de qualquer
 * uma das tabelas; gravar nela escreveria na tabela errada, ou em nenhuma.
 *
 * Por isso a regra aqui é conservadora: na dúvida, recusa **e diz o motivo**.
 * Uma edição bloqueada com explicação custa um clique. Uma edição permitida
 * que grava no lugar errado custa o dado.
 */

export interface OrigemEditavel {
  /** Tabela de destino do UPDATE. Ausente quando não dá para editar. */
  tabela?: string
  /** Por que não dá, em português, para a interface mostrar. */
  motivo?: string
}

export interface PedidoDeOrigem {
  /** A consulta que produziu o resultado. */
  sql: string
  /** Nomes das colunas como vieram no resultado. */
  colunasDoResultado: string[]
  /** Tabelas que o banco tem. */
  tabelasDoBanco: string[]
  /** Colunas reais de cada tabela, por nome de tabela. */
  colunasPorTabela: Record<string, string[]>
}

/**
 * Construções que fazem uma linha da tela deixar de ser uma linha da tabela.
 *
 * `GROUP BY` e `DISTINCT` fundem linhas; agregação inventa valores que não
 * existem em lugar nenhum. Em todos, não há linha de origem para atualizar.
 *
 * `UNION` idem: metade das linhas vem de outro lugar, e nada na grade diz qual
 * é qual.
 */
const COLAPSA_LINHAS = /\b(GROUP\s+BY|DISTINCT|UNION|HAVING)\b/i

function mesmoNome(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function origemEditavel({
  sql,
  colunasDoResultado,
  tabelasDoBanco,
  colunasPorTabela
}: PedidoDeOrigem): OrigemEditavel {
  const consulta = sql.trim()
  if (!consulta) return { motivo: 'a consulta está vazia' }

  if (COLAPSA_LINHAS.test(consulta)) {
    return { motivo: 'o resultado é agrupado, então não há linha única para alterar' }
  }

  const referencias = extractTables(consulta)
  if (referencias.length === 0) {
    return { motivo: 'a consulta não lê de nenhuma tabela' }
  }
  if (referencias.length > 1) {
    // O caso perigoso: a grade parece editável e a coluna `nome` pode vir de
    // qualquer uma das tabelas juntadas.
    return { motivo: 'a consulta junta mais de uma tabela' }
  }

  const escrita = referencias[0].name.split('.').pop() ?? referencias[0].name
  const tabela = tabelasDoBanco.find((t) => mesmoNome(t, escrita))
  if (!tabela) {
    return { motivo: `"${escrita}" não é uma tabela conhecida deste banco` }
  }

  const colunasReais = colunasPorTabela[tabela] ?? []
  if (colunasReais.length === 0) {
    return { motivo: 'as colunas desta tabela ainda não foram carregadas' }
  }

  // Toda coluna da tela precisa existir na tabela. Um apelido (`nome AS n`) ou
  // uma expressão (`preco * 2`) não têm para onde voltar: o UPDATE citaria uma
  // coluna que o banco não tem, e o erro só apareceria na hora de gravar.
  const estranhas = colunasDoResultado.filter(
    (c) => !colunasReais.some((real) => mesmoNome(real, c))
  )
  if (estranhas.length > 0) {
    const lista = estranhas.slice(0, 3).join(', ')
    const resto = estranhas.length > 3 ? ` e mais ${estranhas.length - 3}` : ''
    return { motivo: `o resultado tem coluna calculada ou apelidada (${lista}${resto})` }
  }

  return { tabela }
}
