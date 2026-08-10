import type { Dialect } from '@shared/types'

/**
 * Receitas prontas.
 *
 * Para quem está começando, o problema raramente é sintaxe — é não saber
 * que forma a query deve ter. Cada receita aqui é um padrão real com o
 * lugar do que precisa ser trocado marcado.
 */
export interface Recipe {
  id: string
  title: string
  description: string
  category: 'explorar' | 'filtrar' | 'agrupar' | 'juntar' | 'modificar' | 'manutencao'
  dialects: Dialect[]
  /** `{tabela}` e `{coluna}` são substituídos pela seleção atual da sidebar. */
  sql: string
}

export const RECIPES: Recipe[] = [
  {
    id: 'peek',
    title: 'Espiar uma tabela',
    description: 'As 100 primeiras linhas. Sempre o primeiro passo em tabela desconhecida.',
    category: 'explorar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT *\nFROM {tabela}\nLIMIT 100;'
  },
  {
    id: 'count',
    title: 'Contar linhas',
    description: 'Quantos registros a tabela tem no total.',
    category: 'explorar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT COUNT(*) AS total\nFROM {tabela};'
  },
  {
    id: 'distinct-values',
    title: 'Valores distintos de uma coluna',
    description: 'Descobre quais valores existem e quantas vezes cada um aparece.',
    category: 'explorar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT {coluna}, COUNT(*) AS quantidade\nFROM {tabela}\nGROUP BY {coluna}\nORDER BY quantidade DESC\nLIMIT 50;'
  },
  {
    id: 'nulls',
    title: 'Achar campos vazios',
    description: 'Quantas linhas têm a coluna sem preenchimento.',
    category: 'explorar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT COUNT(*) AS sem_valor\nFROM {tabela}\nWHERE {coluna} IS NULL;'
  },
  {
    id: 'latest',
    title: 'Registros mais recentes',
    description: 'Ordena do mais novo para o mais antigo.',
    category: 'filtrar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT *\nFROM {tabela}\nORDER BY {coluna} DESC\nLIMIT 50;'
  },
  {
    id: 'search-text',
    title: 'Buscar por texto parcial',
    description: 'Procura um trecho dentro da coluna.',
    category: 'filtrar',
    dialects: ['mysql', 'sqlite'],
    sql: "SELECT *\nFROM {tabela}\nWHERE {coluna} LIKE '%termo%'\nLIMIT 100;"
  },
  {
    id: 'search-text-pg',
    title: 'Buscar por texto (sem diferenciar maiúsculas)',
    description: 'ILIKE do PostgreSQL ignora caixa alta e baixa.',
    category: 'filtrar',
    dialects: ['postgres'],
    sql: "SELECT *\nFROM {tabela}\nWHERE {coluna} ILIKE '%termo%'\nLIMIT 100;"
  },
  {
    id: 'date-range',
    title: 'Filtrar por período',
    description: 'Registros entre duas datas.',
    category: 'filtrar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: "SELECT *\nFROM {tabela}\nWHERE {coluna} >= '2024-01-01'\n  AND {coluna} < '2024-02-01'\nORDER BY {coluna};"
  },
  {
    id: 'duplicates',
    title: 'Encontrar duplicados',
    description: 'Valores que aparecem mais de uma vez na coluna.',
    category: 'agrupar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT {coluna}, COUNT(*) AS vezes\nFROM {tabela}\nGROUP BY {coluna}\nHAVING COUNT(*) > 1\nORDER BY vezes DESC;'
  },
  {
    id: 'by-month',
    title: 'Totais por mês',
    description: 'Agrupa registros por mês para ver a evolução.',
    category: 'agrupar',
    dialects: ['mysql'],
    sql: "SELECT DATE_FORMAT({coluna}, '%Y-%m') AS mes, COUNT(*) AS total\nFROM {tabela}\nGROUP BY mes\nORDER BY mes;"
  },
  {
    id: 'by-month-pg',
    title: 'Totais por mês',
    description: 'Agrupa registros por mês usando date_trunc.',
    category: 'agrupar',
    dialects: ['postgres'],
    sql: "SELECT date_trunc('month', {coluna}) AS mes, COUNT(*) AS total\nFROM {tabela}\nGROUP BY mes\nORDER BY mes;"
  },
  {
    id: 'inner-join',
    title: 'Juntar duas tabelas',
    description: 'Traz só o que existe nas duas pontas.',
    category: 'juntar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT a.*, b.*\nFROM {tabela} a\nINNER JOIN outra_tabela b ON b.id = a.outra_id\nLIMIT 100;'
  },
  {
    id: 'left-join-missing',
    title: 'Achar registros órfãos',
    description: 'Linhas da primeira tabela que não têm par na segunda.',
    category: 'juntar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: 'SELECT a.*\nFROM {tabela} a\nLEFT JOIN outra_tabela b ON b.id = a.outra_id\nWHERE b.id IS NULL\nLIMIT 100;'
  },
  {
    id: 'safe-update',
    title: 'Atualizar com segurança',
    description: 'Rode o SELECT primeiro, confira as linhas, só então troque por UPDATE.',
    category: 'modificar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: '-- 1. Confira exatamente o que será alterado:\nSELECT * FROM {tabela} WHERE id = 0;\n\n-- 2. Só depois execute a alteração:\n-- UPDATE {tabela} SET {coluna} = novo_valor WHERE id = 0;'
  },
  {
    id: 'insert',
    title: 'Inserir um registro',
    description: 'Sempre liste as colunas — a ordem física da tabela pode mudar.',
    category: 'modificar',
    dialects: ['mysql', 'postgres', 'sqlite'],
    sql: "INSERT INTO {tabela} (coluna_a, coluna_b)\nVALUES ('valor_a', 'valor_b');"
  },
  {
    id: 'table-sizes-mysql',
    title: 'Tabelas que mais ocupam espaço',
    description: 'Ranking de tamanho em disco.',
    category: 'manutencao',
    dialects: ['mysql'],
    sql: "SELECT table_name,\n       ROUND((data_length + index_length) / 1024 / 1024, 1) AS tamanho_mb,\n       table_rows\nFROM information_schema.tables\nWHERE table_schema = DATABASE()\nORDER BY (data_length + index_length) DESC\nLIMIT 20;"
  },
  {
    id: 'table-sizes-pg',
    title: 'Tabelas que mais ocupam espaço',
    description: 'Ranking de tamanho em disco.',
    category: 'manutencao',
    dialects: ['postgres'],
    sql: "SELECT relname AS tabela,\n       pg_size_pretty(pg_total_relation_size(relid)) AS tamanho\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC\nLIMIT 20;"
  },
  {
    id: 'running-queries-pg',
    title: 'Ver queries rodando agora',
    description: 'Útil para descobrir o que está travando o banco.',
    category: 'manutencao',
    dialects: ['postgres'],
    sql: "SELECT pid, now() - query_start AS duracao, state, query\nFROM pg_stat_activity\nWHERE state <> 'idle'\nORDER BY duracao DESC;"
  },
  {
    id: 'running-queries-mysql',
    title: 'Ver queries rodando agora',
    description: 'Útil para descobrir o que está travando o banco.',
    category: 'manutencao',
    dialects: ['mysql'],
    sql: 'SHOW FULL PROCESSLIST;'
  },
  // ── MongoDB ────────────────────────────────────────────────────────
  {
    id: 'mongo-peek',
    title: 'Espiar uma coleção',
    description: 'Os 20 primeiros documentos, para entender o formato.',
    category: 'explorar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.find({}).limit(20)'
  },
  {
    id: 'mongo-count',
    title: 'Contar documentos',
    description: 'Total de documentos que atendem ao filtro.',
    category: 'explorar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.countDocuments({})'
  },
  {
    id: 'mongo-filter',
    title: 'Filtrar documentos',
    description: 'Condições no mesmo objeto funcionam como AND.',
    category: 'filtrar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.find({ campo: "valor" }).limit(50)'
  },
  {
    id: 'mongo-group',
    title: 'Agrupar e somar',
    description: 'O equivalente ao GROUP BY do SQL.',
    category: 'agrupar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.aggregate([\n  { $group: { _id: "$campo", total: { $sum: 1 } } },\n  { $sort: { total: -1 } },\n  { $limit: 20 }\n])'
  },
  {
    id: 'mongo-lookup',
    title: 'Juntar com outra coleção',
    description: 'O $lookup é o JOIN do MongoDB.',
    category: 'juntar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.aggregate([\n  { $lookup: {\n      from: "outra_colecao",\n      localField: "_id",\n      foreignField: "referencia_id",\n      as: "relacionados"\n  }},\n  { $limit: 20 }\n])'
  },
  {
    id: 'mongo-recent',
    title: 'Documentos mais recentes',
    description: 'Ordena decrescente por um campo de data.',
    category: 'filtrar',
    dialects: ['mongodb'],
    sql: 'db.{tabela}.find({}).sort({ criadoEm: -1 }).limit(50)'
  }
]

export const CATEGORY_LABELS: Record<Recipe['category'], string> = {
  explorar: 'Explorar',
  filtrar: 'Filtrar',
  agrupar: 'Agrupar',
  juntar: 'Juntar tabelas',
  modificar: 'Modificar dados',
  manutencao: 'Manutenção'
}

export function recipesFor(dialect: Dialect): Recipe[] {
  return RECIPES.filter((r) => r.dialects.includes(dialect))
}

/** Troca os marcadores pela tabela e coluna que o usuário tem selecionadas. */
export function fillRecipe(recipe: Recipe, table?: string, column?: string): string {
  return recipe.sql
    .replace(/\{tabela\}/g, table ?? 'nome_da_tabela')
    .replace(/\{coluna\}/g, column ?? 'nome_da_coluna')
}
