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

/** Filtro equivalente para o MongoDB, já como texto do `find()`. */
export function montarFiltroMongo(condicoes: Condicao[]): string {
  const usaveis = condicoes.filter(condicaoUsavel)
  if (usaveis.length === 0) return '{}'

  const escapar = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const partes = usaveis.map((c) => {
    const chave = JSON.stringify(c.coluna)
    const bruto = c.valor.trim()
    const valor = ehNumero(bruto) ? bruto : JSON.stringify(bruto)

    switch (c.operador) {
      case 'igual':
        return `${chave}: ${valor}`
      case 'diferente':
        return `${chave}: { $ne: ${valor} }`
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
