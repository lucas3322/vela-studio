import type { Dialect } from '@shared/types'
import { citarIdentificador, citarLiteral } from './filter-builder.ts'

/**
 * "Gerar INSERT" da seleção múltipla da grade.
 *
 * Um comando por linha, não um `INSERT` multi-linha só: é mais fácil de
 * revisar e de copiar um pedaço no meio, e o formato vale igual nos três
 * dialetos SQL — a única diferença entre eles é a aspa do identificador e do
 * literal, e isso já vem de `filter-builder.ts` (`citarIdentificador`,
 * `citarLiteral`), a mesma função que a barra de filtro usa. Reescrever o
 * escape aqui seria correr o risco de errar de um jeito diferente do filtro.
 *
 * Nada disto executa nada — só monta texto e devolve. Quem decide rodar é o
 * usuário, no editor.
 */

/** Valor da célula como literal SQL, no dialeto pedido. `NULL` sem aspas. */
function literalSql(valor: unknown, dialect: Dialect): string {
  if (valor === null || valor === undefined) return 'NULL'
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : 'NULL'
  // TRUE/FALSE em vez de 1/0: o Postgres não converte inteiro para boolean
  // sozinho, e a palavra-chave funciona nos três dialetos (SQLite e MySQL
  // aceitam como sinônimo).
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE'
  // Coluna JSON chega como objeto/array já decodificado — grava o texto do
  // JSON como literal, que é como o banco espera de volta.
  if (typeof valor === 'object') return citarLiteral(JSON.stringify(valor), dialect)
  return citarLiteral(String(valor), dialect)
}

/**
 * Um `INSERT INTO tabela (...) VALUES (...);` por linha selecionada.
 */
export function gerarInsertSql(
  table: string,
  columns: string[],
  rows: unknown[][],
  dialect: Dialect
): string {
  const colunas = columns.map((c) => citarIdentificador(c, dialect)).join(', ')
  return rows
    .map((row) => {
      const valores = row.map((v) => literalSql(v, dialect)).join(', ')
      return `INSERT INTO ${citarIdentificador(table, dialect)} (${colunas}) VALUES (${valores});`
    })
    .join('\n')
}

/**
 * Um `db.colecao.insertOne({...})` por linha, com o objeto formatado como o
 * app já mostra JSON em outros lugares (`JSON.stringify(obj, null, 2)`).
 */
export function gerarInsertMongo(collection: string, columns: string[], rows: unknown[][]): string {
  return rows
    .map((row) => {
      const objeto = Object.fromEntries(columns.map((c, i) => [c, row[i]]))
      return `db.${collection}.insertOne(${JSON.stringify(objeto, null, 2)});`
    })
    .join('\n\n')
}

/**
 * Comando Redis por linha, conforme a pseudo-tabela de origem.
 *
 * A pseudo-tabela é o único jeito de saber se um array de texto é uma lista
 * ou um set — as duas guardam os elementos exatamente na mesma forma
 * (`lrange`/`smembers` devolvem `string[]`), então o valor sozinho não
 * decide. A montagem de cada comando segue a mesma convenção que
 * `src/main/drivers/redis.ts` já usa para reconstruir cada tipo
 * (`pushRebuild`): lista via `RPUSH` na ordem recebida, set via `SADD`,
 * sorted set via `ZADD` alternando nota e membro.
 */
export function gerarComandosRedis(pseudoTabela: string, columns: string[], rows: unknown[][]): string {
  const indiceKey = columns.indexOf('key')
  const indiceValue = columns.indexOf('value')
  const indiceTtl = columns.indexOf('ttl')

  return rows
    .map((row) => {
      const key = String(row[indiceKey] ?? '')
      const value = indiceValue >= 0 ? row[indiceValue] : undefined
      const ttl = indiceTtl >= 0 ? row[indiceTtl] : null
      return comandoRedisDaLinha(pseudoTabela.toLowerCase(), key, value, ttl)
    })
    .join('\n')
}

function comandoRedisDaLinha(tipo: string, key: string, value: unknown, ttl: unknown): string {
  const chave = aspasRedis(key)

  switch (tipo) {
    case 'strings': {
      const texto = typeof value === 'string' ? value : String(value ?? '')
      const comTtl = ttl !== null && ttl !== undefined && ttl !== '' ? ` EX ${ttl}` : ''
      return `SET ${chave} ${aspasRedis(texto)}${comTtl}`
    }
    case 'hashes': {
      const objeto = (value ?? {}) as Record<string, unknown>
      const pares = Object.entries(objeto)
        .map(([campo, v]) => `${aspasRedis(campo)} ${aspasRedis(stringifyMembro(v))}`)
        .join(' ')
      return `HSET ${chave} ${pares}`
    }
    case 'lists': {
      const itens = ((value ?? []) as unknown[]).map((v) => aspasRedis(stringifyMembro(v))).join(' ')
      return `RPUSH ${chave} ${itens}`
    }
    case 'sets': {
      const itens = ((value ?? []) as unknown[]).map((v) => aspasRedis(stringifyMembro(v))).join(' ')
      return `SADD ${chave} ${itens}`
    }
    case 'sorted-sets': {
      const itens = ((value ?? []) as Array<{ member: string; score: number }>)
        .map((item) => `${item.score} ${aspasRedis(stringifyMembro(item.member))}`)
        .join(' ')
      return `ZADD ${chave} ${itens}`
    }
    default:
      return `# pseudo-tabela desconhecida: ${tipo}`
  }
}

function stringifyMembro(valor: unknown): string {
  return typeof valor === 'string' ? valor : JSON.stringify(valor)
}

/**
 * Aspas duplas em todo token, sempre — não só quando tem espaço.
 *
 * O comando gerado pode voltar a passar pelo tokenizador do próprio app
 * (`tokenizeRedisCommand`, em `redis-parser.ts`), que entende aspa dupla e
 * desfaz `\"` de volta para `"`. Cotar tudo, e não só o que "parece
 * precisar", evita o caso em que um valor vazio some do comando por virar
 * zero tokens.
 */
function aspasRedis(valor: string): string {
  return `"${valor.replace(/"/g, '\\"')}"`
}
