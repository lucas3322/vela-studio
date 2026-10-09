/**
 * Busca difusa da paleta de comandos (⌘K).
 *
 * "pdi" acha `itens_pedido`, "nova ab" acha "Nova aba de query", "sao" acha
 * "São Paulo". O critério é o do Spotlight: as letras precisam aparecer na
 * ordem, mas não juntas — e o que vem junto, no começo ou no início de uma
 * palavra vale mais, porque é assim que a pessoa abrevia.
 *
 * Caixa e acento não contam. Quem digita "historico" não deveria perder o
 * "Histórico" por causa do agudo.
 *
 * Os índices devolvidos são do texto **original**, para a UI destacar as
 * letras que casaram sem ter que normalizar de novo.
 */

export interface FuzzyMatch {
  score: number
  /** Posições no texto original que casaram, em ordem crescente. */
  indices: number[]
}

/** Uma letra sem acento e em minúscula, preservando o comprimento 1. */
function foldChar(ch: string): string {
  const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return folded.length > 0 ? folded[0] : ch
}

/** Normaliza caractere a caractere, para os índices continuarem batendo. */
export function fold(text: string): string {
  let out = ''
  for (const ch of text) out += foldChar(ch)
  return out
}

function isAlnum(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch)
}

/**
 * Começo de palavra: início do texto, depois de separador (`_`, espaço, `.`)
 * ou numa fronteira camelCase (`createdAt` → o `A`).
 */
function isWordStart(original: string, i: number): boolean {
  if (i === 0) return true
  const prev = original[i - 1]
  const cur = original[i]
  if (!isAlnum(prev)) return true
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase() && isAlnum(cur)
}

const BONUS_PREFIX = 40
const BONUS_SUBSTRING = 20
const BONUS_WORD_START = 6
const BONUS_CONTIGUOUS = 4
const PENALTY_GAP = 0.5

/**
 * Pontua `text` contra `query`. `null` quando as letras não aparecem na ordem.
 * Consulta vazia casa com tudo, com pontuação zero.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  // Espaço na consulta é ignorado: "nova aba" e "novaaba" querem o mesmo item.
  const q = fold(query).replace(/\s+/g, '')
  if (q.length === 0) return { score: 0, indices: [] }

  // Trabalha sobre a lista de code points, para emoji e afins não deslocarem
  // os índices em relação a `fold`.
  const chars = Array.from(text)
  const t = chars.map(foldChar).join('')
  const original = chars.join('')
  if (q.length > t.length) return null

  // 1. Trecho contíguo — o caso mais forte. Entre as ocorrências, vale a que
  //    começa numa palavra: "ped" em "itens_pedido" casa o "pedido", não um
  //    "ped" perdido no meio.
  let best: FuzzyMatch | null = null
  let from = t.indexOf(q)
  while (from !== -1) {
    const wordStart = isWordStart(original, from)
    const score =
      BONUS_SUBSTRING +
      q.length * (1 + BONUS_CONTIGUOUS) +
      (from === 0 ? BONUS_PREFIX : 0) +
      (wordStart ? BONUS_WORD_START * 2 : 0) -
      from * PENALTY_GAP
    if (!best || score > best.score) {
      best = { score, indices: Array.from({ length: q.length }, (_, k) => from + k) }
    }
    from = t.indexOf(q, from + 1)
  }
  if (best) return best

  // 2. Subsequência. Para cada letra da consulta, prefere a próxima ocorrência
  //    que seja começo de palavra, se ela existir antes de a letra seguinte
  //    ficar impossível; senão, a mais próxima.
  const indices: number[] = []
  let pos = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const nearest = t.indexOf(ch, pos)
    if (nearest === -1) return null

    let chosen = nearest
    // Só salta para um começo de palavra se a letra anterior não for contígua:
    // quebrar uma sequência já casada custaria mais do que ganha.
    const prev = indices[indices.length - 1]
    if (!(prev !== undefined && nearest === prev + 1) && !isWordStart(original, nearest)) {
      for (let j = nearest + 1; j < t.length; j++) {
        if (t[j] === ch && isWordStart(original, j)) {
          // O resto da consulta ainda precisa caber depois de `j`.
          if (isSubsequence(q.slice(qi + 1), t, j + 1)) chosen = j
          break
        }
      }
    }
    indices.push(chosen)
    pos = chosen + 1
  }

  let score = 0
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]
    score += 1
    if (isWordStart(original, i)) score += BONUS_WORD_START
    if (k > 0 && indices[k - 1] === i - 1) score += BONUS_CONTIGUOUS
    if (k > 0) score -= (i - indices[k - 1] - 1) * PENALTY_GAP
  }
  if (indices[0] === 0) score += BONUS_PREFIX / 2
  score -= indices[0] * PENALTY_GAP
  return { score, indices }
}

function isSubsequence(q: string, t: string, start: number): boolean {
  let pos = start
  for (const ch of q) {
    const found = t.indexOf(ch, pos)
    if (found === -1) return false
    pos = found + 1
  }
  return true
}

/**
 * Divide o texto em trechos casados e não casados, para a UI pintar.
 * Trechos vizinhos do mesmo tipo saem juntos: menos `<mark>` no DOM.
 */
export function splitByMatch(
  text: string,
  indices: number[]
): Array<{ text: string; match: boolean }> {
  const chars = Array.from(text)
  const set = new Set(indices)
  const parts: Array<{ text: string; match: boolean }> = []
  for (let i = 0; i < chars.length; i++) {
    const match = set.has(i)
    const last = parts[parts.length - 1]
    if (last && last.match === match) last.text += chars[i]
    else parts.push({ text: chars[i], match })
  }
  return parts
}
