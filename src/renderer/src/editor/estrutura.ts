/**
 * Leitura da estrutura de uma tabela para a ficha de Colunas, Índices e
 * Relações. Lógica pura: nada aqui toca React nem IPC.
 */

export type CategoriaDeTipo = 'numero' | 'texto' | 'data' | 'booleano' | 'json' | 'binario' | 'outro'

/*
 * A ordem dos testes importa: `datetime` contém `time`, `tinyint(1)` é
 * booleano no MySQL antes de ser número, `interval` não é inteiro apesar do
 * `int` no meio. Por isso cada padrão casa a palavra inteira, não um pedaço.
 */
const PADROES: [CategoriaDeTipo, RegExp][] = [
  ['booleano', /^(bool|boolean|bit|tinyint\(1\))(?!\w)/],
  ['data', /^(date|datetime\d*|timestamp|timestamptz|time|timetz|year|interval)(?!\w)/],
  ['json', /^(json|jsonb|object|array|document)(?!\w)/],
  ['binario', /^(blob|tinyblob|mediumblob|longblob|binary|varbinary|bytea|bindata)(?!\w)/],
  [
    'numero',
    /^(int|integer|tinyint|smallint|mediumint|bigint|serial|bigserial|smallserial|decimal|numeric|dec|real|double|float|float4|float8|int2|int4|int8|money|number|long)(?!\w)/
  ],
  ['texto', /^(char|varchar|character|text|tinytext|mediumtext|longtext|string|nchar|nvarchar|citext|uuid|enum|set|clob|name)(?!\w)/]
]

/**
 * Família do tipo cru do banco — decide a cor e o glifo da coluna na ficha,
 * com o mesmo vocabulário de cor que a grade usa para o dado.
 */
export function categoriaDoTipo(tipo: string): CategoriaDeTipo {
  const limpo = tipo.trim().toLowerCase().replace(/^unsigned\s+/, '')
  for (const [categoria, padrao] of PADROES) {
    if (padrao.test(limpo)) return categoria
  }
  return 'outro'
}

/**
 * O que acontece com esta linha quando a linha referenciada muda, em
 * português. `NO ACTION` sozinho não diz nada a quem está aprendendo; "impede
 * a exclusão" diz o que vai acontecer quando ele tentar.
 */
export function explicarAcaoReferencial(acao: string | undefined, evento: 'excluir' | 'atualizar'): string {
  const normal = (acao ?? 'NO ACTION').trim().toUpperCase()
  switch (normal) {
    case 'CASCADE':
      return evento === 'excluir' ? 'apaga junto' : 'atualiza junto'
    case 'SET NULL':
      return 'vira NULL'
    case 'SET DEFAULT':
      return 'volta ao padrão'
    case 'RESTRICT':
    case 'NO ACTION':
      return evento === 'excluir' ? 'impede a exclusão' : 'impede a alteração'
    default:
      return normal.toLowerCase()
  }
}

/**
 * Colunas de chave estrangeira que nenhum índice cobre.
 *
 * Um índice só serve para uma coluna se ela for a **primeira** dele — um
 * índice em `(status, cliente_id)` não ajuda a buscar por `cliente_id`. O
 * PostgreSQL e o SQLite não criam índice para FK sozinhos, então todo JOIN
 * por uma coluna destas varre a tabela inteira; o MySQL cria, e aqui a lista
 * sai vazia por conta própria.
 */
export function chavesSemIndice(
  relacoes: { column: string }[],
  indices: { columns: string[] }[],
  chavesPrimarias: string[]
): string[] {
  const cobertas = new Set<string>()
  for (const indice of indices) if (indice.columns[0]) cobertas.add(indice.columns[0])
  if (chavesPrimarias[0]) cobertas.add(chavesPrimarias[0])

  const vistas = new Set<string>()
  const faltando: string[] = []
  for (const { column } of relacoes) {
    if (cobertas.has(column) || vistas.has(column)) continue
    vistas.add(column)
    faltando.push(column)
  }
  return faltando
}

/** Nome de índice previsível, que cabe no limite de 63 caracteres do PostgreSQL. */
export function nomeDeIndice(tabela: string, coluna: string): string {
  return `idx_${tabela}_${coluna}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 63)
}
