import type { QueryColumn } from '../../shared/types'

/**
 * O grid alinha números à direita, pinta datas e colapsa JSON.
 * Para isso precisa de um tipo por coluna — e nem todo driver informa um bom.
 * Então inferimos pelo primeiro valor não-nulo.
 */
export function inferColumnType(values: unknown[]): QueryColumn['type'] {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (typeof value === 'number' || typeof value === 'bigint') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    if (value instanceof Date) return 'date'
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) return 'binary'
    if (typeof value === 'object') return 'json'
    if (typeof value === 'string') return 'string'
  }
  return 'null'
}

/** Mapeia o tipo declarado do banco para a categoria do grid. */
export function typeFromDeclared(declared: string | undefined): QueryColumn['type'] | undefined {
  if (!declared) return undefined
  const t = declared.toLowerCase()
  if (/int|serial|numeric|decimal|float|double|real|money|bit\b/.test(t)) return 'number'
  if (/bool/.test(t)) return 'boolean'
  if (/date|time|year/.test(t)) return 'date'
  if (/json|jsonb/.test(t)) return 'json'
  if (/blob|bytea|binary/.test(t)) return 'binary'
  return 'string'
}

/**
 * Serializa um valor para atravessar o IPC.
 * Datas viram ISO, Buffers viram um resumo legível, BigInt vira string —
 * structured clone não passa BigInt e o renderer não precisa do valor bruto.
 */
export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) {
    return `0x${value.subarray(0, 32).toString('hex')}${value.length > 32 ? '…' : ''}`
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).subarray(0, 32).toString('hex')}`
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    } catch {
      return String(value)
    }
  }
  return value
}

/**
 * Converte linhas já em formato de array na matriz do grid.
 *
 * É a forma correta para SQL: `SELECT c.id, p.id FROM c JOIN p` devolve duas
 * colunas chamadas `id`, e passar por objeto colapsaria as duas em uma — o
 * usuário veria uma coluna a menos, sem nenhum aviso. Aqui a posição manda,
 * não o nome.
 */
export function toGridFromArrays(
  names: string[],
  rows: unknown[][],
  declaredTypes?: Array<string | undefined>
): { columns: QueryColumn[]; matrix: unknown[][] } {
  const sample = rows.slice(0, 50)
  const columns: QueryColumn[] = names.map((name, index) => ({
    name,
    type:
      typeFromDeclared(declaredTypes?.[index]) ??
      inferColumnType(sample.map((row) => row[index]))
  }))
  return { columns, matrix: rows.map((row) => row.map(serializeValue)) }
}

/** Converte um array de objetos (formato de driver de documentos) na matriz do grid. */
export function toGrid(
  rows: Record<string, unknown>[],
  declaredTypes?: Record<string, string>
): { columns: QueryColumn[]; matrix: unknown[][] } {
  if (rows.length === 0) return { columns: [], matrix: [] }

  // Mongo pode devolver documentos com chaves diferentes: unimos preservando a ordem.
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        names.push(key)
      }
    }
  }

  const columns: QueryColumn[] = names.map((name) => ({
    name,
    type:
      typeFromDeclared(declaredTypes?.[name]) ??
      inferColumnType(rows.slice(0, 50).map((r) => r[name]))
  }))

  const matrix = rows.map((row) => names.map((name) => serializeValue(row[name])))
  return { columns, matrix }
}
