/**
 * Analisador de contexto do cursor.
 *
 * É o que separa um autocomplete útil de uma lista alfabética inútil:
 * depois de `FROM` o usuário quer tabelas; depois de `SELECT` quer colunas;
 * depois de `c.` quer as colunas da tabela que `c` apelida.
 *
 * Não usamos um parser SQL completo de propósito. A query em edição está
 * quase sempre sintaticamente inválida — um parser estrito recusaria justo
 * quando mais precisamos de sugestão. Um tokenizador tolerante acerta mais.
 */

export type ClauseKind =
  | 'select'
  | 'from'
  | 'join'
  | 'on'
  | 'where'
  | 'groupBy'
  | 'orderBy'
  | 'having'
  | 'insert'
  | 'insertColumns'
  | 'update'
  | 'set'
  | 'values'
  | 'unknown'

export interface TableRef {
  /** Nome da tabela como escrito na query. */
  name: string
  /** Apelido, quando houver: `FROM contracts c` → alias 'c'. */
  alias?: string
}

export interface SqlContext {
  clause: ClauseKind
  /** Tabelas visíveis no statement atual — o universo de colunas sugeríveis. */
  tables: TableRef[]
  /** Preenchido quando o cursor está logo após `alias.` ou `tabela.` */
  qualifier?: string
  /** Texto que o usuário já digitou da palavra atual. */
  prefix: string
  /** Statement isolado em que o cursor está. */
  statement: string
}

const CLAUSE_KEYWORDS: Record<string, ClauseKind> = {
  SELECT: 'select',
  FROM: 'from',
  JOIN: 'join',
  'INNER JOIN': 'join',
  'LEFT JOIN': 'join',
  'RIGHT JOIN': 'join',
  'FULL JOIN': 'join',
  'CROSS JOIN': 'join',
  ON: 'on',
  WHERE: 'where',
  'GROUP BY': 'groupBy',
  'ORDER BY': 'orderBy',
  HAVING: 'having',
  UPDATE: 'update',
  SET: 'set',
  VALUES: 'values',
  'INSERT INTO': 'insert'
}

/** Palavras que nunca são apelido de tabela, mesmo aparecendo depois do nome. */
const NOT_ALIASES = new Set([
  'WHERE', 'ON', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'GROUP',
  'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'SET', 'VALUES', 'USING',
  'AS', 'AND', 'OR', 'SELECT', 'FROM', 'INTO', 'RETURNING', 'FETCH', 'WINDOW'
])

/** Isola o statement do cursor: ponto e vírgula delimita, respeitando strings. */
export function statementAtOffset(sql: string, offset: number): { text: string; start: number } {
  let start = 0
  let inString: string | null = null

  for (let i = 0; i < offset; i++) {
    const char = sql[i]
    if (inString) {
      if (char === '\\') i++
      else if (char === inString) inString = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') inString = char
    else if (char === ';') start = i + 1
  }

  let end = sql.length
  inString = null
  for (let i = offset; i < sql.length; i++) {
    const char = sql[i]
    if (inString) {
      if (char === '\\') i++
      else if (char === inString) inString = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') inString = char
    else if (char === ';') {
      end = i
      break
    }
  }

  return { text: sql.slice(start, end), start }
}

/**
 * Decide o que o ⌘↵ executa.
 *
 * A regra, na ordem: **seleção vence sempre** — selecionar é uma intenção
 * explícita, e quem selecionou meia linha quer rodar meia linha. Sem seleção,
 * roda o statement onde o cursor está, não o editor inteiro.
 *
 * Mora aqui, fora do componente, porque é a regra que já falhou uma vez em
 * produção (o ⌘↵ executava o arquivo todo) e dentro do `QueryEditor` nenhum
 * teste alcança: seria preciso instanciar o Monaco.
 *
 * Devolve `undefined` quando não há nada executável — seleção só de espaço em
 * branco, ou cursor num trecho vazio entre dois `;`. Melhor não fazer nada do
 * que mandar string vazia para o banco.
 */
export function sqlParaExecutar(entrada: {
  texto: string
  /** Posição do cursor no texto completo. */
  offset: number
  /** Texto selecionado, se houver. */
  selecao?: string
}): string | undefined {
  if (entrada.selecao && entrada.selecao.trim()) return entrada.selecao.trim()

  const { text } = statementAtOffset(entrada.texto, entrada.offset)
  return text.trim() || undefined
}

/** Remove comentários e conteúdo de string, preservando o comprimento (offsets continuam válidos). */
function maskNonCode(text: string): string {
  let masked = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '-' && next === '-') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      masked += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      masked += ' '.repeat(stop - i)
      i = stop
      continue
    }
    // Só aspas simples são mascaradas. Aspas duplas e crases delimitam
    // identificadores (`FROM "minha tabela"`), e apagá-las esconderia
    // justamente o nome que precisamos extrair.
    if (char === "'") {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '\\') j += 2
        else if (text[j] === "'") break
        else j++
      }
      const stop = Math.min(j + 1, text.length)
      // Mantém as aspas: elas sinalizam "aqui era um literal".
      masked += "'" + ' '.repeat(Math.max(0, stop - i - 2)) + (stop - i > 1 ? "'" : '')
      i = stop
      continue
    }
    masked += char
    i++
  }
  return masked
}

/** Descobre a cláusula pela última palavra-chave estrutural antes do cursor. */
function detectClause(before: string): ClauseKind {
  const upper = before.toUpperCase()
  let bestClause: ClauseKind = 'unknown'
  let bestIndex = -1

  for (const [keyword, clause] of Object.entries(CLAUSE_KEYWORDS)) {
    const pattern = new RegExp(`\\b${keyword.replace(/ /g, '\\s+')}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(upper))) {
      if (match.index > bestIndex) {
        bestIndex = match.index
        bestClause = clause
      }
    }
  }

  // `INSERT INTO tabela (` → estamos listando colunas, não valores.
  if (bestClause === 'insert') {
    const afterInsert = before.slice(bestIndex)
    const opens = (afterInsert.match(/\(/g) ?? []).length
    const closes = (afterInsert.match(/\)/g) ?? []).length
    if (opens > closes) return 'insertColumns'
  }
  return bestClause
}

/**
 * Identificador SQL: entre crases, aspas duplas, colchetes, ou nu.
 * A forma citada precisa aceitar espaço — `FROM "minha tabela" t` é válido
 * e era exatamente o caso que a versão anterior lia errado.
 */
const IDENT = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[\\w.$]+)'

/** Extrai as tabelas do statement junto com seus apelidos. */
export function extractTables(statement: string): TableRef[] {
  const masked = maskNonCode(statement)
  const tables: TableRef[] = []
  const pattern = new RegExp(
    `\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(${IDENT})(?:\\s+(?:AS\\s+)?(${IDENT}))?`,
    'gi'
  )

  let match: RegExpExecArray | null
  while ((match = pattern.exec(masked))) {
    const rawName = match[1]
    const rawAlias = match[2]
    if (!rawName) continue

    const name = unquote(rawName)
    if (!name || name === '(') continue

    const alias = rawAlias && !NOT_ALIASES.has(rawAlias.toUpperCase()) ? unquote(rawAlias) : undefined
    // Evita duplicar quando a mesma tabela entra em JOIN e FROM sem alias.
    if (!tables.some((t) => t.name === name && t.alias === alias)) {
      tables.push({ name, alias })
    }
  }
  return tables
}

function unquote(value: string): string {
  return value.replace(/^[`"[]/, '').replace(/[`"\]]$/, '')
}

/** Ponto de entrada: tudo que o autocomplete precisa saber sobre onde o cursor está. */
export function analyze(sql: string, offset: number): SqlContext {
  const { text: statement, start } = statementAtOffset(sql, offset)
  const localOffset = offset - start
  const before = maskNonCode(statement.slice(0, localOffset))

  // Palavra sendo digitada e qualificador (`c.` em `c.nome`).
  const tail = /([\w$]*)$/.exec(before)?.[1] ?? ''
  const qualifierMatch = /([\w$]+)\s*\.\s*([\w$]*)$/.exec(before)

  return {
    clause: detectClause(before),
    tables: extractTables(statement),
    qualifier: qualifierMatch?.[1],
    prefix: qualifierMatch ? qualifierMatch[2] : tail,
    statement
  }
}

/** Resolve `c` para `contracts`, ou devolve o próprio nome se já for a tabela. */
export function resolveQualifier(qualifier: string, tables: TableRef[]): string | undefined {
  const lower = qualifier.toLowerCase()
  const byAlias = tables.find((t) => t.alias?.toLowerCase() === lower)
  if (byAlias) return byAlias.name
  const byName = tables.find((t) => t.name.toLowerCase() === lower)
  return byName?.name
}
