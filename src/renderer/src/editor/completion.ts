import type { ColumnInfo, Dialect, TableInfo } from '@shared/types'
import { monaco } from './monaco-setup'
import { analyze, resolveQualifier, type SqlContext } from './sql-context'
import { SQL_DOCS, MONGO_DOCS, lookupDoc } from './sql-docs'

export interface SchemaProvider {
  tables: TableInfo[]
  columns: Record<string, ColumnInfo[]>
  dialect: Dialect
}

/** O provider lê a referência viva; trocar de conexão não exige recriar o provider. */
export type SchemaAccessor = () => SchemaProvider | undefined

const KEYWORDS_BY_DIALECT: Record<string, string[]> = {
  common: [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
    'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON',
    'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'EXISTS',
    'DISTINCT', 'AS', 'ASC', 'DESC', 'UNION', 'UNION ALL', 'WITH', 'CASE', 'WHEN',
    'THEN', 'ELSE', 'END', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE'
  ],
  mysql: ['IFNULL', 'GROUP_CONCAT', 'NOW()', 'CURDATE()', 'DATE_FORMAT', 'LIMIT'],
  postgres: ['ILIKE', 'RETURNING', 'COALESCE', 'NOW()', 'CURRENT_DATE', 'JSONB_AGG', 'ARRAY_AGG'],
  sqlite: ['IFNULL', "datetime('now')", 'GROUP_CONCAT']
}

const FUNCTIONS = [
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST', 'UPPER', 'LOWER',
  'TRIM', 'LENGTH', 'ROUND', 'ABS', 'CONCAT', 'SUBSTRING', 'REPLACE'
]

/**
 * Autocomplete que entende onde o cursor está.
 * A ordem de decisão importa: qualificador ganha de cláusula, porque
 * `c.` é uma intenção muito mais específica do que "estou no SELECT".
 */
export function registerSqlCompletion(getSchema: SchemaAccessor): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', ','],

    provideCompletionItems(model, position) {
      const schema = getSchema()
      const offset = model.getOffsetAt(position)
      const context = analyze(model.getValue(), offset)

      const word = model.getWordUntilPosition(position)
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const suggestions: monaco.languages.CompletionItem[] = []

      // 1. `alias.` → colunas daquela tabela, e nada mais.
      if (context.qualifier && schema) {
        const table = resolveQualifier(context.qualifier, context.tables) ?? context.qualifier
        const columns = findColumns(schema, table)
        if (columns.length) {
          suggestions.push(...columns.map((c, i) => columnItem(c, table, range, i)))
          return { suggestions }
        }
      }

      // 2. Depois de FROM/JOIN/UPDATE/INTO → tabelas.
      if (schema && ['from', 'join', 'insert', 'update'].includes(context.clause)) {
        suggestions.push(...schema.tables.map((t, i) => tableItem(t, range, i)))
        // Continuamos para incluir keywords: o usuário pode querer uma subconsulta.
      }

      // 3. Onde colunas fazem sentido.
      const CLAUSULAS_DE_COLUNA = [
        'select', 'where', 'on', 'groupBy', 'orderBy', 'having', 'set', 'insertColumns'
      ]
      if (schema && CLAUSULAS_DE_COLUNA.includes(context.clause)) {
        if (context.tables.length > 0) {
          suggestions.push(...columnsInScope(schema, context, range))
          // Tabelas com apelido também completam: `c` → `c.`
          suggestions.push(...aliasItems(context, range))
        } else {
          /**
           * Nenhuma tabela no statement ainda — é o caso de quem escreve o
           * SELECT antes do FROM.
           *
           * A versão anterior despejava aqui as colunas de **todas** as
           * tabelas do schema. Num banco pequeno isso ajudava; em um de 200
           * tabelas viram milhares de entradas ambíguas, e a lista deixa de
           * ser útil — foi o que aconteceu.
           *
           * Sem saber a tabela não dá para dizer de qual coluna se trata.
           * Sugerimos as tabelas: é o que falta para o resto funcionar.
           */
          suggestions.push(...schema.tables.map((t, i) => tableItem(t, range, i)))
        }
      }

      // 4. Palavras-chave e funções sempre disponíveis, com prioridade menor.
      suggestions.push(...keywordItems(schema?.dialect ?? 'mysql', range, context))
      suggestions.push(...functionItems(range))

      // 5. Sem schema e sem contexto, ainda oferecemos as tabelas conhecidas.
      if (schema && context.clause === 'unknown') {
        suggestions.push(...schema.tables.map((t, i) => tableItem(t, range, 400 + i)))
      }

      return { suggestions: dedupe(suggestions) }
    }
  })
}

function findColumns(schema: SchemaProvider, table: string): ColumnInfo[] {
  const exact = schema.columns[table]
  if (exact) return exact
  const key = Object.keys(schema.columns).find((k) => k.toLowerCase() === table.toLowerCase())
  return key ? schema.columns[key] : []
}

/** Colunas de todas as tabelas do statement, prefixadas quando há mais de uma. */
function columnsInScope(
  schema: SchemaProvider,
  context: SqlContext,
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = []
  const multiTable = context.tables.length > 1

  context.tables.forEach((ref, tableIndex) => {
    const columns = findColumns(schema, ref.name)
    columns.forEach((column, columnIndex) => {
      const prefix = multiTable && ref.alias ? `${ref.alias}.` : ''
      items.push({
        label: {
          label: `${prefix}${column.name}`,
          detail: `  ${column.type}`,
          description: ref.name
        },
        kind: column.isPrimaryKey
          ? monaco.languages.CompletionItemKind.Constant
          : monaco.languages.CompletionItemKind.Field,
        insertText: `${prefix}${column.name}`,
        range,
        // Ordenação: tabela por tabela, coluna por coluna, na ordem física.
        sortText: `0${tableIndex}${String(columnIndex).padStart(4, '0')}`,
        documentation: { value: describeColumn(column, ref.name) }
      })
    })
  })

  return items
}

function aliasItems(context: SqlContext, range: monaco.IRange): monaco.languages.CompletionItem[] {
  return context.tables
    .filter((t) => t.alias)
    .map((t) => ({
      label: { label: t.alias!, description: `apelido de ${t.name}` },
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: `${t.alias!}.`,
      range,
      sortText: `1${t.alias}`,
      // Inserir o ponto e reabrir a lista encadeia alias → coluna num gesto só.
      command: { id: 'editor.action.triggerSuggest', title: 'sugerir colunas' }
    }))
}

function tableItem(
  table: TableInfo,
  range: monaco.IRange,
  index: number
): monaco.languages.CompletionItem {
  const kindLabel = table.type === 'view' ? 'view' : table.type === 'collection' ? 'coleção' : 'tabela'
  return {
    label: {
      label: table.name,
      detail: table.rowCount != null ? `  ~${formatCount(table.rowCount)} linhas` : '',
      description: kindLabel
    },
    kind:
      table.type === 'view'
        ? monaco.languages.CompletionItemKind.Interface
        : monaco.languages.CompletionItemKind.Struct,
    insertText: table.name,
    range,
    sortText: `0${String(index).padStart(4, '0')}`,
    documentation: {
      value:
        `**${table.name}** — ${kindLabel}` +
        (table.rowCount != null ? `\n\nAproximadamente **${formatCount(table.rowCount)}** linhas.` : '')
    }
  }
}

function columnItem(
  column: ColumnInfo,
  table: string,
  range: monaco.IRange,
  index: number
): monaco.languages.CompletionItem {
  return {
    label: {
      label: column.name,
      detail: `  ${column.type}`,
      description: column.isPrimaryKey ? 'chave primária' : column.isForeignKey ? 'chave estrangeira' : ''
    },
    kind: column.isPrimaryKey
      ? monaco.languages.CompletionItemKind.Constant
      : monaco.languages.CompletionItemKind.Field,
    insertText: column.name,
    range,
    sortText: `0${String(index).padStart(4, '0')}`,
    documentation: { value: describeColumn(column, table) }
  }
}

function describeColumn(column: ColumnInfo, table: string): string {
  const lines = [`**${column.name}**  \`${column.type}\``, '', `Tabela: \`${table}\``]
  if (column.isPrimaryKey) lines.push('', '🔑 Chave primária')
  if (column.isForeignKey) lines.push('', '🔗 Chave estrangeira')
  lines.push('', column.nullable ? 'Aceita `NULL`' : 'Obrigatória (`NOT NULL`)')
  if (column.defaultValue) lines.push('', `Padrão: \`${column.defaultValue}\``)
  if (column.frequency != null) lines.push('', `Presente em ${column.frequency}% dos documentos amostrados`)
  if (column.comment) lines.push('', `_${column.comment}_`)
  return lines.join('\n')
}

function keywordItems(
  dialect: Dialect,
  range: monaco.IRange,
  context: SqlContext
): monaco.languages.CompletionItem[] {
  const keywords = [
    ...KEYWORDS_BY_DIALECT.common,
    ...(KEYWORDS_BY_DIALECT[dialect] ?? [])
  ]

  return keywords.map((keyword) => {
    const doc = SQL_DOCS[keyword]
    return {
      label: { label: keyword, description: doc?.summary ?? '' },
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      // Keyword vem depois de tabela e coluna, exceto quando não sabemos a cláusula.
      sortText: `${context.clause === 'unknown' ? 2 : 7}${keyword}`,
      documentation: doc ? { value: renderDoc(keyword, doc) } : undefined
    }
  })
}

function functionItems(range: monaco.IRange): monaco.languages.CompletionItem[] {
  return FUNCTIONS.map((fn) => {
    const doc = SQL_DOCS[fn]
    return {
      label: { label: `${fn}()`, description: doc?.summary ?? 'função' },
      kind: monaco.languages.CompletionItemKind.Function,
      insertText: `${fn}($0)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: `6${fn}`,
      documentation: doc ? { value: renderDoc(fn, doc) } : undefined
    }
  })
}

function renderDoc(term: string, doc: { detail: string; example?: string; gotcha?: string }): string {
  const parts = [doc.detail]
  if (doc.example) parts.push('', '```sql', doc.example, '```')
  if (doc.gotcha) parts.push('', `⚠️ ${doc.gotcha}`)
  return parts.join('\n')
}

function dedupe(items: monaco.languages.CompletionItem[]): monaco.languages.CompletionItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const label = typeof item.label === 'string' ? item.label : item.label.label
    const key = `${label}::${item.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(value)
}

/** Autocomplete para o editor Mongo: coleções, campos e operadores. */
export function registerMongoCompletion(getSchema: SchemaAccessor): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.', '$', '{', ' '],

    provideCompletionItems(model, position) {
      const schema = getSchema()
      if (!schema || schema.dialect !== 'mongodb') return { suggestions: [] }

      const line = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      })
      const word = model.getWordUntilPosition(position)
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      // `db.` → coleções
      if (/\bdb\.\s*[\w]*$/.test(line)) {
        return {
          suggestions: schema.tables.map((t, i) => ({
            label: { label: t.name, description: 'coleção' },
            kind: monaco.languages.CompletionItemKind.Struct,
            insertText: t.name,
            range,
            sortText: String(i).padStart(4, '0')
          }))
        }
      }

      // `db.colecao.` → métodos
      const methodMatch = /\bdb\.([\w]+)\.\s*[\w]*$/.exec(line)
      if (methodMatch) {
        const methods = [
          'find', 'findOne', 'aggregate', 'countDocuments', 'distinct',
          'insertOne', 'insertMany', 'updateOne', 'updateMany',
          'deleteOne', 'deleteMany', 'indexes'
        ]
        return {
          suggestions: methods.map((method, i) => {
            const doc = MONGO_DOCS[method]
            return {
              label: { label: method, description: doc?.summary ?? '' },
              kind: monaco.languages.CompletionItemKind.Method,
              insertText: `${method}($0)`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: String(i).padStart(3, '0'),
              documentation: doc ? { value: renderDoc(method, doc) } : undefined
            }
          })
        }
      }

      const suggestions: monaco.languages.CompletionItem[] = []

      // Campos da coleção mencionada na linha.
      const collectionMatch = /\bdb\.([\w]+)\./.exec(line)
      if (collectionMatch) {
        const fields = findColumns(schema, collectionMatch[1])
        suggestions.push(
          ...fields.map((field, i) => ({
            label: {
              label: field.name,
              detail: `  ${field.type}`,
              description: field.frequency != null ? `${field.frequency}%` : ''
            },
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: field.name,
            range,
            sortText: `0${String(i).padStart(4, '0')}`,
            documentation: { value: describeColumn(field, collectionMatch[1]) }
          }))
        )
      }

      // Operadores $ — sempre úteis dentro de um filtro.
      suggestions.push(
        ...Object.entries(MONGO_DOCS)
          .filter(([name]) => name.startsWith('$'))
          .map(([name, doc]) => ({
            label: { label: name, description: doc.summary },
            kind: monaco.languages.CompletionItemKind.Operator,
            insertText: name,
            range,
            sortText: `1${name}`,
            documentation: { value: renderDoc(name, doc) }
          }))
      )

      return { suggestions }
    }
  })
}

/** Hover: passar o mouse em qualquer palavra explica o que ela faz. */
export function registerHover(getSchema: SchemaAccessor, language: string): monaco.IDisposable {
  return monaco.languages.registerHoverProvider(language, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null

      const schema = getSchema()
      const dialect = schema?.dialect ?? 'mysql'
      const line = model.getLineContent(position.lineNumber)

      // Palavras compostas primeiro: "GROUP BY" vale mais que "GROUP".
      const compound = detectCompound(line, word.word, position.column)
      const doc = lookupDoc(compound ?? word.word, dialect)

      if (doc) {
        const contents: monaco.IMarkdownString[] = [
          { value: `**${compound ?? word.word.toUpperCase()}** — ${doc.summary}` },
          { value: doc.detail }
        ]
        if (doc.example) contents.push({ value: '```sql\n' + doc.example + '\n```' })
        if (doc.gotcha) contents.push({ value: `⚠️ **Atenção:** ${doc.gotcha}` })
        return { contents }
      }

      if (!schema) return null

      // Não é palavra-chave: pode ser tabela ou coluna do schema.
      const table = schema.tables.find((t) => t.name.toLowerCase() === word.word.toLowerCase())
      if (table) {
        const columns = findColumns(schema, table.name)
        const preview = columns
          .slice(0, 12)
          .map((c) => `- \`${c.name}\` ${c.type}${c.isPrimaryKey ? ' 🔑' : ''}`)
          .join('\n')
        return {
          contents: [
            { value: `**${table.name}** — ${table.type === 'view' ? 'view' : 'tabela'}` },
            {
              value:
                `${columns.length} colunas${table.rowCount != null ? `, ~${formatCount(table.rowCount)} linhas` : ''}\n\n` +
                preview +
                (columns.length > 12 ? `\n\n_…e mais ${columns.length - 12}_` : '')
            }
          ]
        }
      }

      for (const [tableName, columns] of Object.entries(schema.columns)) {
        const column = columns.find((c) => c.name.toLowerCase() === word.word.toLowerCase())
        if (column) return { contents: [{ value: describeColumn(column, tableName) }] }
      }

      return null
    }
  })
}

/** Detecta se a palavra faz parte de uma expressão de duas palavras. */
function detectCompound(line: string, word: string, column: number): string | undefined {
  const upper = line.toUpperCase()
  const target = word.toUpperCase()
  const pairs = [
    'GROUP BY', 'ORDER BY', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN',
    'CROSS JOIN', 'IS NULL', 'IS NOT NULL', 'INSERT INTO', 'DELETE FROM',
    'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'UNION ALL'
  ]
  for (const pair of pairs) {
    if (!pair.includes(target)) continue
    const index = upper.indexOf(pair)
    if (index === -1) continue
    // O cursor precisa estar dentro da expressão para ela valer.
    if (column - 1 >= index && column - 1 <= index + pair.length) return pair
  }
  return undefined
}
