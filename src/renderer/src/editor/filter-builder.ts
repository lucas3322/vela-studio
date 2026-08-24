import type { Dialect } from '@shared/types'

/**
 * Monta a cláusula `WHERE` da barra de filtro rápido.
 *
 * ## Por que o valor é escapado aqui, e não parametrizado
 *
 * O caminho de execução (`query.run`) recebe SQL como texto — é o mesmo canal
 * do editor, onde a pessoa escreve o comando que quiser. Não existe lista de
 * parâmetros para pendurar o valor, e criar uma só para o filtro significaria
 * um segundo caminho de execução com regras próprias.
 *
 * A saída disso é escapar corretamente e **mostrar o SQL gerado na tela**: a
 * pessoa vê exatamente o que vai rodar antes de rodar. Nos bancos suportados,
 * dobrar a aspa simples encerra a citação; o MySQL ainda interpreta a barra
 * invertida dentro de literal, então ela também é dobrada — sem isso, um valor
 * terminado em `\` engoliria a aspa de fechamento e o resto da linha viraria
 * comando.
 */

export type OperadorId =
  | 'igual'
  | 'diferente'
  | 'contem'
  | 'comeca'
  | 'termina'
  | 'maior'
  | 'menor'
  | 'vazio'
  | 'naoVazio'

export interface Operador {
  id: OperadorId
  rotulo: string
  /** Operadores de nulo não têm campo de valor. */
  semValor?: boolean
}

/** Rótulos em português: a barra existe para quem ainda não escreve SQL. */
export const OPERADORES: Operador[] = [
  { id: 'igual', rotulo: 'é igual a' },
  { id: 'diferente', rotulo: 'é diferente de' },
  { id: 'contem', rotulo: 'contém' },
  { id: 'comeca', rotulo: 'começa com' },
  { id: 'termina', rotulo: 'termina com' },
  { id: 'maior', rotulo: 'é maior que' },
  { id: 'menor', rotulo: 'é menor que' },
  { id: 'vazio', rotulo: 'está vazio', semValor: true },
  { id: 'naoVazio', rotulo: 'não está vazio', semValor: true }
]

export interface Condicao {
  coluna: string
  operador: OperadorId
  valor: string
}

export function operadorTemValor(id: OperadorId): boolean {
  return !OPERADORES.find((o) => o.id === id)?.semValor
}

/** Condição só entra no SQL quando está completa. */
export function condicaoUsavel(c: Condicao): boolean {
  if (!c.coluna) return false
  return operadorTemValor(c.operador) ? c.valor.trim() !== '' : true
}

/** Cada banco cita identificador de um jeito; errar quebra nome com espaço. */
export function citarIdentificador(nome: string, dialect: Dialect): string {
  if (dialect === 'mysql') return `\`${nome.replace(/`/g, '``')}\``
  return `"${nome.replace(/"/g, '""')}"`
}

/**
 * Literal de texto seguro.
 *
 * A aspa simples é dobrada em todos os bancos. A barra invertida só é dobrada
 * no MySQL, onde ela escapa dentro de literal por padrão — no PostgreSQL e no
 * SQLite ela é um caractere comum, e dobrá-la mudaria o valor procurado.
 */
export function citarLiteral(valor: string, dialect: Dialect): string {
  const escapado =
    dialect === 'mysql'
      ? valor.replace(/\\/g, '\\\\').replace(/'/g, "''")
      : valor.replace(/'/g, "''")
  return `'${escapado}'`
}

/** Número puro entra sem aspas; o resto vira texto. */
function ehNumero(valor: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(valor.trim())
}

function comoValor(valor: string, dialect: Dialect): string {
  const limpo = valor.trim()
  return ehNumero(limpo) ? limpo : citarLiteral(limpo, dialect)
}

/**
 * `%` e `_` são curingas do LIKE: quem digita "50%" procura o texto, não o
 * padrão. A barra invertida vira o caractere de escape do LIKE.
 *
 * O `ESCAPE` também passa pelo `citarLiteral`. Escrever `ESCAPE '\\'` direto no
 * template gera `ESCAPE '\'`, e no MySQL esse literal fica **sem terminar** —
 * a barra escapa a própria aspa de fechamento e o comando quebra.
 */
function paraLike(valor: string, dialect: Dialect, molde: (v: string) => string): string {
  const neutralizado = valor.trim().replace(/([%_\\])/g, '\\$1')
  return `${citarLiteral(molde(neutralizado), dialect)} ESCAPE ${citarLiteral('\\', dialect)}`
}

function expressao(condicao: Condicao, dialect: Dialect): string {
  const col = citarIdentificador(condicao.coluna, dialect)

  switch (condicao.operador) {
    case 'igual':
      return `${col} = ${comoValor(condicao.valor, dialect)}`
    case 'diferente':
      // `<>` em vez de `!=`: é o operador do padrão e vale em todos eles.
      return `${col} <> ${comoValor(condicao.valor, dialect)}`
    case 'maior':
      return `${col} > ${comoValor(condicao.valor, dialect)}`
    case 'menor':
      return `${col} < ${comoValor(condicao.valor, dialect)}`
    case 'contem':
      return `${col} LIKE ${paraLike(condicao.valor, dialect, (v) => `%${v}%`)}`
    case 'comeca':
      return `${col} LIKE ${paraLike(condicao.valor, dialect, (v) => `${v}%`)}`
    case 'termina':
      return `${col} LIKE ${paraLike(condicao.valor, dialect, (v) => `%${v}`)}`
    case 'vazio':
      return `${col} IS NULL`
    case 'naoVazio':
      return `${col} IS NOT NULL`
  }
}

/**
 * Devolve o `WHERE` pronto, ou string vazia se nenhuma condição está completa.
 *
 * As condições são unidas por `AND` — a barra não oferece `OR` de propósito:
 * misturar os dois exige parênteses para não mudar de sentido, e uma interface
 * que produz `a AND b OR c` silenciosamente entrega outra consulta.
 */
export function montarWhere(condicoes: Condicao[], dialect: Dialect): string {
  const usaveis = condicoes.filter(condicaoUsavel)
  if (usaveis.length === 0) return ''
  return `WHERE ${usaveis.map((c) => expressao(c, dialect)).join(' AND ')}`
}

/**
 * O valor de uma condição, no tipo que o campo do Mongo realmente guarda.
 *
 * ## Por que o tipo do campo importa aqui, e não no SQL
 *
 * A igualdade do MongoDB é **tipada**: `{ MSISDN: 5519983017492 }` não casa com
 * o documento que guarda `"5519983017492"`. O SQL converte sozinho e perdoa;
 * o Mongo devolve zero documento e não reclama de nada.
 *
 * Era esse o defeito: adivinhar o tipo pelo formato do texto. Um MSISDN, um
 * CPF, um CEP sem hífen — tudo isso *parece* número e é guardado como texto.
 * A busca voltava vazia e a IDE dizia "executado com sucesso", o que se lê
 * como "esse registro não existe" quando na verdade é "procurei do jeito
 * errado".
 *
 * O driver já amostra os documentos e sabe o tipo de cada campo. Usar isso é a
 * própria tese do produto: a IDE conhece o schema e usa o que conhece.
 */
export function valorParaMongo(bruto: string, tipoDoCampo?: string): string {
  const limpo = bruto.trim()
  const tipos = (tipoDoCampo ?? '').split('|').map((t) => t.trim().toLowerCase())
  const temTexto = tipos.includes('string')
  const temNumero = tipos.includes('number')

  // Campo declaradamente de texto: cita sempre, mesmo parecendo número. É o
  // caso do MSISDN que motivou tudo.
  if (temTexto && !temNumero) return JSON.stringify(limpo)
  if (temNumero && !temTexto) return ehNumero(limpo) ? limpo : JSON.stringify(limpo)

  // Sem informação de tipo, ou tipo misto: cai no formato do texto.
  return ehNumero(limpo) ? limpo : JSON.stringify(limpo)
}

/**
 * O campo guarda os dois tipos na amostra?
 *
 * Coleção que foi migrada no meio da vida costuma ter documentos antigos com
 * número e novos com texto. Procurar por um só tipo acha metade — e é a
 * metade errada com igual probabilidade.
 */
function tipoMisto(tipoDoCampo: string | undefined, bruto: string): boolean {
  const tipos = (tipoDoCampo ?? '').split('|').map((t) => t.trim().toLowerCase())
  return tipos.includes('string') && tipos.includes('number') && ehNumero(bruto.trim())
}

/** Filtro equivalente para o MongoDB, já como texto do `find()`. */
export function montarFiltroMongo(
  condicoes: Condicao[],
  tiposPorCampo: Record<string, string> = {}
): string {
  const usaveis = condicoes.filter(condicaoUsavel)
  if (usaveis.length === 0) return '{}'

  const escapar = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const partes = usaveis.map((c) => {
    const chave = JSON.stringify(c.coluna)
    const bruto = c.valor.trim()
    const tipo = tiposPorCampo[c.coluna]
    const valor = valorParaMongo(bruto, tipo)

    // Campo com os dois tipos na amostra: procura pelos dois. Um `$in` continua
    // usando o índice, então não custa desempenho — e achar metade dos
    // documentos seria pior do que demorar um pouco mais.
    const ambos = `{ $in: [${bruto}, ${JSON.stringify(bruto)}] }`

    switch (c.operador) {
      case 'igual':
        return tipoMisto(tipo, bruto) ? `${chave}: ${ambos}` : `${chave}: ${valor}`
      case 'diferente':
        return tipoMisto(tipo, bruto)
          ? `${chave}: { $nin: [${bruto}, ${JSON.stringify(bruto)}] }`
          : `${chave}: { $ne: ${valor} }`
      case 'maior':
        return `${chave}: { $gt: ${valor} }`
      case 'menor':
        return `${chave}: { $lt: ${valor} }`
      case 'contem':
        return `${chave}: { $regex: ${JSON.stringify(escapar(bruto))} }`
      case 'comeca':
        return `${chave}: { $regex: ${JSON.stringify('^' + escapar(bruto))} }`
      case 'termina':
        return `${chave}: { $regex: ${JSON.stringify(escapar(bruto) + '$')} }`
      case 'vazio':
        return `${chave}: null`
      case 'naoVazio':
        return `${chave}: { $ne: null }`
    }
  })
  return `{ ${partes.join(', ')} }`
}
