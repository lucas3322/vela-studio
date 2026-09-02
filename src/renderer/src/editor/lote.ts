import type { QueryError, QueryResult } from '@shared/types'

/**
 * Execução de vários comandos, um a um, com relato do que passou e do que não.
 *
 * ## Por que um a um
 *
 * Mandar o lote inteiro numa chamada devolve um pacote de resultados — ou um
 * erro só. Quando o terceiro de dez quebra, não dá para dizer **qual** quebrou
 * nem o que já tinha sido aplicado antes. A pessoa fica com um erro genérico e
 * um banco em estado desconhecido, o que é a pior combinação possível.
 *
 * Executando um a um, cada comando tem começo, fim e destino próprios.
 *
 * ## Por que para no primeiro erro
 *
 * Em lote de SQL o comando seguinte quase sempre depende do anterior: se o
 * terceiro cria uma tabela e o quarto insere nela, seguir depois da falha
 * produz uma cascata de erros que escondem o primeiro — o único que importa.
 *
 * Mas há o caso oposto, dez `UPDATE` independentes onde se quer saber de todas
 * as falhas de uma vez. Por isso a escolha não é feita de antemão: para no
 * erro, **mostra qual foi**, e oferece continuar dali. Decidir com o erro na
 * tela é melhor do que adivinhar antes de rodar.
 */

export type EstadoDoPasso = 'espera' | 'rodando' | 'ok' | 'erro' | 'pulado'

export interface PassoDoLote {
  sql: string
  estado: EstadoDoPasso
  /** Linhas devolvidas ou afetadas, quando o comando terminou. */
  linhas?: number
  duracaoMs?: number
  erro?: QueryError
  resultados?: QueryResult[]
}

/** Estado inicial: tudo esperando. */
export function prepararLote(statements: string[]): PassoDoLote[] {
  return statements.map((sql) => ({ sql, estado: 'espera' }))
}

/**
 * O que aconteceu com um comando, a partir do que o canal devolveu.
 *
 * Um `error` presente é falha mesmo que venham resultados junto: alguns
 * bancos devolvem as duas coisas, e tratar como sucesso porque "veio
 * resultado" esconderia a quebra.
 */
export function classificarPasso(
  passo: PassoDoLote,
  saida: { results: QueryResult[]; error?: QueryError },
  duracaoMs: number
): PassoDoLote {
  if (saida.error) {
    return { ...passo, estado: 'erro', erro: saida.error, duracaoMs }
  }
  const linhas = saida.results.reduce(
    (soma, r) => soma + (r.rowCount ?? r.affectedRows ?? 0),
    0
  )
  return { ...passo, estado: 'ok', linhas, duracaoMs, resultados: saida.results }
}

export interface ResumoDoLote {
  total: number
  ok: number
  erros: number
  pendentes: number
  /** Índice do comando que quebrou, para a lista rolar até ele. */
  indiceDoErro?: number
  terminou: boolean
}

export function resumirLote(passos: PassoDoLote[]): ResumoDoLote {
  const ok = passos.filter((p) => p.estado === 'ok').length
  const erros = passos.filter((p) => p.estado === 'erro').length
  const pendentes = passos.filter((p) => p.estado === 'espera' || p.estado === 'rodando').length
  const indiceDoErro = passos.findIndex((p) => p.estado === 'erro')

  return {
    total: passos.length,
    ok,
    erros,
    pendentes,
    indiceDoErro: indiceDoErro >= 0 ? indiceDoErro : undefined,
    // Terminou quando nada mais está esperando **e** nada está rodando. Um
    // lote parado no erro não terminou: ainda há a decisão de continuar.
    terminou: pendentes === 0
  }
}

/**
 * Frase do rodapé do modal.
 *
 * Diz o que foi aplicado, não só o que falhou. Depois de um erro no meio, a
 * pergunta que a pessoa precisa responder é "o que já entrou no banco?" — e
 * essa é a resposta.
 */
export function descreverLote(passos: PassoDoLote[]): string {
  const { total, ok, erros, pendentes } = resumirLote(passos)

  if (erros === 0 && pendentes === 0) {
    return `${total} comando${total > 1 ? 's' : ''} executado${total > 1 ? 's' : ''} com sucesso.`
  }
  if (erros > 0) {
    const restam = pendentes > 0 ? `, ${pendentes} não executado${pendentes > 1 ? 's' : ''}` : ''
    return `${ok} de ${total} aplicado${ok === 1 ? '' : 's'}${restam}. Parou no comando ${
      (resumirLote(passos).indiceDoErro ?? 0) + 1
    }.`
  }
  return `${ok} de ${total} executado${ok === 1 ? '' : 's'}…`
}

/**
 * Um resumo de uma linha do comando, para a lista.
 *
 * O comando inteiro pode ter vinte linhas; a lista precisa de algo que caiba e
 * que identifique. As primeiras palavras bastam — é por elas que quem escreveu
 * reconhece o próprio comando.
 */
export function resumirComando(sql: string, limite = 90): string {
  const numaLinha = sql.replace(/\s+/g, ' ').trim()
  return numaLinha.length <= limite ? numaLinha : `${numaLinha.slice(0, limite - 1)}…`
}
