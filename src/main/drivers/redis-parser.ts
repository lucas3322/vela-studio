/**
 * Partes do driver Redis que não tocam rede — por isso moram separadas de
 * `redis.ts`, no mesmo espírito de `mongo-parser.ts`: dá para testar sem
 * `ioredis` instalado nem banco no ar, e o teste falha rápido quando o
 * tokenizador ou o classificador de escrita erram, em vez de aparecer só
 * como "célula errada" três telas depois.
 */

/**
 * As cinco pseudo-tabelas que o driver sintetiza. O Redis não tem tabela —
 * isto é só uma lente sobre os cinco tipos de valor que ele conhece, uma
 * pseudo-tabela por tipo.
 */
export const PSEUDO_TABLES = ['strings', 'hashes', 'lists', 'sets', 'sorted-sets'] as const

export type PseudoTable = (typeof PSEUDO_TABLES)[number]

/** Tipo Redis (o que `TYPE key` devolve) correspondente a cada pseudo-tabela. */
export const TABLE_TO_REDIS_TYPE: Record<PseudoTable, string> = {
  strings: 'string',
  hashes: 'hash',
  lists: 'list',
  sets: 'set',
  'sorted-sets': 'zset'
}

const REDIS_TYPE_TO_TABLE: Record<string, PseudoTable> = Object.fromEntries(
  Object.entries(TABLE_TO_REDIS_TYPE).map(([table, type]) => [type, table as PseudoTable])
) as Record<string, PseudoTable>

export function isPseudoTableName(name: string): name is PseudoTable {
  return (PSEUDO_TABLES as readonly string[]).includes(name.toLowerCase())
}

/** Nome da pseudo-tabela para um tipo Redis, ou `undefined` se não for um dos cinco conhecidos. */
export function tableForRedisType(redisType: string): PseudoTable | undefined {
  return REDIS_TYPE_TO_TABLE[redisType.toLowerCase()]
}

/**
 * Tipo Redis por trás de uma pseudo-tabela — lança se o nome não for um dos
 * cinco. A mensagem lista as opções porque quem chama normalmente digitou o
 * nome errado à mão (editor de SQL reaproveitado, sem autocomplete próprio
 * ainda).
 */
export function redisTypeForTable(table: string): string {
  const chave = table.toLowerCase()
  if (isPseudoTableName(chave)) return TABLE_TO_REDIS_TYPE[chave]
  throw new Error(
    `"${table}" não é uma pseudo-tabela do Redis. Use uma destas: ${PSEUDO_TABLES.join(', ')}.`
  )
}

/**
 * Separa uma linha de comando Redis em tokens, respeitando aspas simples e
 * duplas — é o que permite `SET "minha chave" "hello world"` em vez de virar
 * quatro tokens soltos. Barra invertida escapa a aspa que abriu o token.
 *
 * Statements individuais já chegam aqui separados por `splitStatements`
 * (`shared/sql-shape.ts`), que também entende aspas — então o `;` dentro de
 * uma string nunca corta o comando antes de chegar neste tokenizador.
 */
export function tokenizeRedisCommand(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: '"' | "'" | null = null
  let i = 0

  while (i < line.length) {
    const char = line[i]

    if (quote) {
      if (char === '\\' && line[i + 1] === quote) {
        current += quote
        i += 2
        continue
      }
      if (char === quote) {
        quote = null
        i++
        continue
      }
      current += char
      i++
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      i++
      continue
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      i++
      continue
    }

    current += char
    hasToken = true
    i++
  }

  if (hasToken) tokens.push(current)
  return tokens
}

/**
 * Comandos de leitura conhecidos — tudo que não está aqui é tratado como
 * escrita, inclusive comando desconhecido. É a escolha mais segura: bloquear
 * por engano um comando inofensivo numa conexão somente-leitura incomoda;
 * deixar passar uma escrita disfarçada de comando exótico corrompe dado. O
 * projeto já pagou caro por falha silenciosa (ver CLAUDE.md), então o viés
 * aqui é sempre para o lado que avisa.
 *
 * Classificação é pelo **primeiro token só** — `CONFIG` fica de fora de
 * propósito mesmo que `CONFIG GET` seja leitura, porque `CONFIG SET` não é, e
 * o classificador não olha o segundo argumento. Mesmo raciocínio para `SORT`
 * (tem variante `STORE`) e para os comandos de administração/pub-sub.
 */
const REDIS_READ_COMMANDS = new Set([
  // Genéricos de chave.
  'GET', 'MGET', 'STRLEN', 'GETRANGE', 'SUBSTR', 'EXISTS', 'TYPE', 'TTL', 'PTTL',
  'EXPIRETIME', 'PEXPIRETIME', 'RANDOMKEY', 'DBSIZE', 'SCAN', 'KEYS', 'TOUCH',
  // Hash.
  'HGET', 'HMGET', 'HGETALL', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HRANDFIELD',
  'HSCAN', 'HSTRLEN',
  // Lista.
  'LRANGE', 'LLEN', 'LINDEX', 'LPOS',
  // Set.
  'SMEMBERS', 'SCARD', 'SISMEMBER', 'SMISMEMBER', 'SRANDMEMBER', 'SDIFF', 'SINTER',
  'SUNION', 'SSCAN', 'SINTERCARD',
  // Sorted set.
  'ZRANGE', 'ZRANGEBYSCORE', 'ZRANGEBYLEX', 'ZREVRANGE', 'ZREVRANGEBYSCORE',
  'ZREVRANGEBYLEX', 'ZCARD', 'ZSCORE', 'ZMSCORE', 'ZRANK', 'ZREVRANK', 'ZCOUNT',
  'ZLEXCOUNT', 'ZDIFF', 'ZINTER', 'ZUNION', 'ZRANDMEMBER', 'ZSCAN', 'ZINTERCARD',
  // Bitmap.
  'BITCOUNT', 'BITPOS', 'GETBIT', 'BITFIELD_RO',
  // Stream.
  'XRANGE', 'XREVRANGE', 'XLEN', 'XREAD', 'XINFO',
  // Geo.
  'GEOPOS', 'GEODIST', 'GEOHASH', 'GEOSEARCH',
  // HyperLogLog.
  'PFCOUNT',
  // Servidor/diagnóstico.
  'PING', 'ECHO', 'INFO', 'TIME', 'LASTSAVE', 'LOLWUT', 'OBJECT', 'MEMORY', 'DUMP',
  // Controle de transação: não escrevem por si — o que dentro delas escreve
  // segue sujeito à mesma classificação quando é o próprio comando que roda.
  'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH'
])

/** O comando (primeiro token, sem diferenciar caixa) escreve no banco? */
export function isRedisWrite(command: string): boolean {
  return !REDIS_READ_COMMANDS.has(command.toUpperCase())
}

/** Acha o padrão depois de um `MATCH` na lista de tokens, sem diferenciar caixa. */
export function extractMatchPattern(tokens: string[]): string | undefined {
  const index = tokens.findIndex((token) => token.toUpperCase() === 'MATCH')
  if (index === -1) return undefined
  return tokens[index + 1]
}
