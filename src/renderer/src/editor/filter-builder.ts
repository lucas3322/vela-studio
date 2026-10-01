import type { Dialect } from '@shared/types'
import { fusoDoComputador, paraIsoComDeslocamento } from '../../../shared/datas.ts'

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
export function valorParaMongo(
  bruto: string,
  tipoDoCampo?: string,
  fuso: string = fusoDoComputador()
): string {
  const limpo = bruto.trim()
  const tipos = (tipoDoCampo ?? '').split('|').map((t) => t.trim().toLowerCase())
  const temTexto = tipos.includes('string')
  const temNumero = tipos.includes('number')

  /*
    Campo de data: o valor vira `ISODate(...)`, não texto.

    Comparar `"2025-08-01 00:00:00"` com um campo `Date` não dá erro — o Mongo
    ordena por tipo antes de ordenar por valor, e texto nunca é "maior" que
    data. O filtro voltava vazio e dizia "executado com sucesso".

    O texto digitado é lido no mesmo fuso em que a grade mostra as datas, e o
    deslocamento vai **escrito** na prévia (`-03:00`): filtrar pelo valor que se
    está vendo na tela acha exatamente aquele documento.
  */
  if (tipos.includes('date') && !temTexto) {
    const iso = paraIsoComDeslocamento(limpo, fuso)
    if (iso) return `ISODate(${JSON.stringify(iso)})`
  }

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

/**
 * O que uma condição exige do campo: um valor exato, ou uma lista de operadores.
 *
 * Separado do texto final porque duas condições sobre o **mesmo campo**
 * precisam ser juntadas, e juntar texto pronto é o que causava o bug — ver
 * `montarFiltroMongo`.
 */
type Exigencia = { valor: string } | { operadores: Array<[string, string]> }

function exigenciaMongo(c: Condicao, tipo: string | undefined, fuso: string): Exigencia {
  const escapar = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const bruto = c.valor.trim()
  const valor = valorParaMongo(bruto, tipo, fuso)
  const ambos = `[${bruto}, ${JSON.stringify(bruto)}]`

  switch (c.operador) {
    case 'igual':
      // Campo com os dois tipos na amostra: procura pelos dois. Um `$in`
      // continua usando o índice, então não custa desempenho — e achar metade
      // dos documentos seria pior do que demorar um pouco mais.
      return tipoMisto(tipo, bruto) ? { operadores: [['$in', ambos]] } : { valor }
    case 'diferente':
      return tipoMisto(tipo, bruto)
        ? { operadores: [['$nin', ambos]] }
        : { operadores: [['$ne', valor]] }
    case 'maior':
      return { operadores: [['$gt', valor]] }
    case 'menor':
      return { operadores: [['$lt', valor]] }
    case 'contem':
      return { operadores: [['$regex', JSON.stringify(escapar(bruto))]] }
    case 'comeca':
      return { operadores: [['$regex', JSON.stringify('^' + escapar(bruto))]] }
    case 'termina':
      return { operadores: [['$regex', JSON.stringify(escapar(bruto) + '$')]] }
    case 'vazio':
      return { valor: 'null' }
    case 'naoVazio':
      return { operadores: [['$ne', 'null']] }
  }
}

function comoTexto(exigencia: Exigencia): string {
  if ('valor' in exigencia) return exigencia.valor
  return `{ ${exigencia.operadores.map(([op, v]) => `${op}: ${v}`).join(', ')} }`
}

/**
 * Filtro equivalente para o MongoDB, já como texto do `find()`.
 *
 * ## Duas condições no mesmo campo
 *
 * "Data maior que 01/08 **e** menor que 31/08" são duas condições no mesmo
 * campo. Escritas uma ao lado da outra, viravam
 * `{ "DATA": { $gt: … }, "DATA": { $lt: … } }` — chave repetida num objeto, e
 * a segunda **apaga** a primeira. O `$gt` sumia calado: o filtro devolvia tudo
 * até o dia 31, desde o começo da coleção.
 *
 * Agora as condições do mesmo campo se juntam num objeto só
 * (`{ $gt: …, $lt: … }`). Quando não dá para juntar — duas vezes o mesmo
 * operador, ou um valor exato ao lado de um operador —, vão para um `$and`,
 * que é a forma que nunca perde nada.
 */
export function montarFiltroMongo(
  condicoes: Condicao[],
  tiposPorCampo: Record<string, string> = {},
  fuso: string = fusoDoComputador()
): string {
  const usaveis = condicoes.filter(condicaoUsavel)
  if (usaveis.length === 0) return '{}'

  // Agrupadas por campo, na ordem em que o campo apareceu pela primeira vez.
  const porCampo = new Map<string, Exigencia[]>()
  for (const c of usaveis) {
    const lista = porCampo.get(c.coluna) ?? []
    lista.push(exigenciaMongo(c, tiposPorCampo[c.coluna], fuso))
    porCampo.set(c.coluna, lista)
  }

  const partes: string[] = []
  const conjuncao: string[] = []

  for (const [campo, exigencias] of porCampo) {
    const chave = JSON.stringify(campo)
    if (exigencias.length === 1) {
      partes.push(`${chave}: ${comoTexto(exigencias[0])}`)
      continue
    }

    const soOperadores = exigencias.every((e) => 'operadores' in e)
    const pares = soOperadores
      ? exigencias.flatMap((e) => ('operadores' in e ? e.operadores : []))
      : []
    const operadoresDistintos = new Set(pares.map(([op]) => op)).size === pares.length

    if (soOperadores && operadoresDistintos) {
      partes.push(`${chave}: ${comoTexto({ operadores: pares })}`)
    } else {
      for (const e of exigencias) conjuncao.push(`{ ${chave}: ${comoTexto(e)} }`)
    }
  }

  if (conjuncao.length > 0) partes.push(`$and: [${conjuncao.join(', ')}]`)
  return `{ ${partes.join(', ')} }`
}
