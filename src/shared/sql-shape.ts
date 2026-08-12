/**
 * Reconhecimento da *forma* de um comando SQL, sem executar nada.
 *
 * Mora em `shared/` porque os dois lados precisam: o main para decidir o que
 * bloquear numa conexão somente-leitura, e o renderer para avisar antes de
 * rodar um `UPDATE` sem `WHERE`. Duplicar essas regras deixaria a interface
 * dizendo uma coisa e o driver fazendo outra.
 *
 * Nada aqui toca `node:` nem driver — é análise de texto.
 */

/** Divide um lote em statements, respeitando strings, comentários e $$ do Postgres. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false
  let dollarTag: string | null = null

  while (i < sql.length) {
    const char = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      current += char
      if (char === '\n') inLineComment = false
      i++
      continue
    }
    if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        i += 2
        inBlockComment = false
        continue
      }
      i++
      continue
    }
    if (dollarTag) {
      current += char
      if (char === '$' && sql.startsWith(dollarTag, i)) {
        current += sql.slice(i + 1, i + dollarTag.length)
        i += dollarTag.length
        dollarTag = null
        continue
      }
      i++
      continue
    }
    if (inSingle || inDouble || inBacktick) {
      current += char
      const quote = inSingle ? "'" : inDouble ? '"' : '`'
      if (char === '\\') {
        // Escape: consome o próximo caractere junto.
        if (next !== undefined) {
          current += next
          i += 2
          continue
        }
      }
      if (char === quote) {
        // '' dentro de string é aspas escapada, não fim.
        if (next === quote) {
          current += next
          i += 2
          continue
        }
        inSingle = inDouble = inBacktick = false
      }
      i++
      continue
    }

    if (char === '-' && next === '-') {
      inLineComment = true
      current += char
      i++
      continue
    }
    if (char === '/' && next === '*') {
      inBlockComment = true
      current += char + next
      i += 2
      continue
    }
    if (char === "'") { inSingle = true; current += char; i++; continue }
    if (char === '"') { inDouble = true; current += char; i++; continue }
    if (char === '`') { inBacktick = true; current += char; i++; continue }
    if (char === '$') {
      const match = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))
      if (match) {
        dollarTag = match[0]
        current += dollarTag
        i += dollarTag.length
        continue
      }
    }
    if (char === ';') {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      i++
      continue
    }

    current += char
    i++
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements
}

/** Statement que escreve? Usado pelo modo somente-leitura. */
export function isMutation(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toUpperCase()
  return /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE|MERGE|CALL)\b/.test(
    stripped
  )
}

/** UPDATE/DELETE sem WHERE é o erro mais caro que existe. Detectamos antes de rodar. */
export function isUnboundedMutation(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toUpperCase()
  if (!/^(UPDATE|DELETE)\b/.test(stripped)) return false
  return !/\bWHERE\b/.test(stripped)
}
