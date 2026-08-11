import type {
  ColumnInfo,
  ConnectionConfig,
  Dialect,
  IndexInfo,
  QueryResult,
  RelationInfo,
  TableInfo,
  TestResult
} from '../../shared/types'

export interface QueryOptions {
  /** Identificador para cancelamento. */
  queryId: string
  database?: string
  /** Teto de linhas trazidas pro renderer. Acima disso cortamos e avisamos. */
  maxRows?: number
}

/**
 * Todo banco suportado implementa isso — SQL ou NoSQL, sem exceção.
 * A UI só conhece essa interface, nunca o driver concreto.
 */
export interface DatabaseDriver {
  readonly dialect: Dialect

  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  testConnection(config: ConnectionConfig): Promise<TestResult>

  listDatabases(): Promise<string[]>
  listTables(database?: string): Promise<TableInfo[]>
  listColumns(table: string, database?: string): Promise<ColumnInfo[]>
  listIndexes(table: string, database?: string): Promise<IndexInfo[]>
  listRelations(table: string, database?: string): Promise<RelationInfo[]>

  /** DDL de criação da tabela, para o menu de contexto e para documentação. */
  getCreateStatement(table: string, database?: string): Promise<string>

  /**
   * Monta o SQL de uma operação destrutiva sem executá-la.
   * Separado de propósito: a UI mostra o comando exato antes de confirmar,
   * e quem quiser pode mandá-lo para o editor em vez de rodar direto.
   */
  buildDangerStatement(kind: 'truncate' | 'drop', table: string): string

  /**
   * Monta o `ALTER` que troca o tipo de uma coluna — sem executá-lo.
   *
   * Assíncrono porque alguns bancos exigem ler o catálogo antes: no MySQL,
   * `MODIFY COLUMN` reescreve a definição inteira, então omitir `NOT NULL`,
   * `DEFAULT` ou `COMMENT` os **apaga em silêncio**. A implementação precisa
   * reemitir tudo que já existia.
   *
   * Quem não consegue fazer isso (SQLite não altera tipo de coluna; MongoDB
   * não tem schema) deve lançar erro explicando o caminho alternativo, nunca
   * devolver um comando que não faz o prometido.
   */
  buildAlterColumnTypeStatement(params: AlterColumnParams): Promise<string>

  /**
   * Altera o valor de uma célula, identificando a linha pela chave primária.
   *
   * Implementações DEVEM:
   *  - recusar `keys` vazio;
   *  - usar consulta parametrizada, nunca concatenar o valor no SQL;
   *  - rodar dentro de transação e desfazer se afetar mais de uma linha.
   *
   * O último item é o que impede o pior caso: uma chave mal formada que
   * casaria com metade da tabela.
   */
  updateCell(params: {
    table: string
    database?: string
    column: string
    value: unknown
    keys: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }>

  /** Remove uma linha pela chave primária, com as mesmas garantias. */
  deleteRow(params: {
    table: string
    database?: string
    keys: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }>

  /** Executa um ou mais statements e devolve um resultado por statement. */
  query(sql: string, options: QueryOptions): Promise<QueryResult[]>
  cancel(queryId: string): Promise<void>

  /** Versão do servidor, para exibir na status bar. */
  serverVersion(): Promise<string | undefined>
}

/**
 * Quantas linhas voltam quando a query **não** diz quantas quer.
 *
 * `SELECT * FROM pedidos` numa tabela de milhões é sempre acidente, nunca
 * intenção — quem quer mais escreve `LIMIT`. Cem linhas bastam para entender
 * o formato dos dados, que é o motivo real de rodar um SELECT sem filtro.
 */
export const PREVIEW_ROWS = 100

/**
 * Teto de segurança quando a query **tem** LIMIT próprio.
 * Respeitamos o que a pessoa pediu até aqui; acima disso o renderer sofre.
 */
export const DEFAULT_MAX_ROWS = 50_000

/** A query já declara quantas linhas quer? */
export function hasExplicitLimit(sql: string): boolean {
  const code = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .toUpperCase()
  return /\b(LIMIT|FETCH\s+FIRST|FETCH\s+NEXT|TOP)\b/.test(code)
}

/**
 * Acrescenta `LIMIT` a um SELECT que não tem nenhum.
 *
 * Cortar as linhas depois de recebê-las não resolve o problema: o banco já
 * varreu a tabela e já mandou tudo pela rede. O limite precisa ir junto da
 * query.
 *
 * A injeção é deliberadamente covarde — só mexe em statement que começa com
 * SELECT ou WITH e não contém construções onde um LIMIT no fim mudaria o
 * sentido. Em qualquer outro caso devolve o texto intacto, e o corte no
 * cliente continua valendo como rede de proteção.
 */
export function applyPreviewLimit(sql: string, rows: number): string {
  const code = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toUpperCase()

  if (!/^(SELECT|WITH)\b/.test(code)) return sql
  if (hasExplicitLimit(sql)) return sql
  // `INTO OUTFILE`, `FOR UPDATE` e afins não combinam com um LIMIT anexado.
  if (/\b(INTO\s+(OUTFILE|DUMPFILE|@)|FOR\s+UPDATE|FOR\s+SHARE|PROCEDURE\s+ANALYSE)\b/.test(code)) {
    return sql
  }

  // Nova linha porque o statement pode terminar em comentário de linha.
  return `${sql.replace(/;\s*$/, '')}\nLIMIT ${rows}`
}

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


/**
 * Valida a chave antes de qualquer escrita.
 *
 * Chamado por todos os drivers: é a rede que garante que nenhuma edição saia
 * sem uma condição que isole a linha.
 */
export interface AlterColumnParams {
  table: string
  column: string
  /** Tipo novo, como o usuário digitou (`varchar(80)`, `int`, `numeric(12,2)`). */
  newType: string
  database?: string
}

/**
 * Recusa tipo que não tenha cara de tipo.
 *
 * O valor é interpolado no DDL — não existe placeholder para tipo em nenhum
 * dos bancos. Então a barreira é de forma: letras, dígitos, espaço, parênteses,
 * vírgula. Nada de aspas, ponto e vírgula ou traço, que é o que permitiria
 * emendar um segundo comando no ALTER.
 */
export function exigirTipoValido(tipo: string): string {
  const limpo = tipo.trim()
  if (!limpo) throw new Error('Informe o tipo da coluna.')
  if (!/^[A-Za-z][A-Za-z0-9 (),]*$/.test(limpo)) {
    throw new Error(
      `"${tipo}" não parece um tipo de coluna. Use algo como varchar(80), int ou numeric(12,2).`
    )
  }
  return limpo
}

export function exigirChave(keys: Record<string, unknown>): Array<[string, unknown]> {
  const entradas = Object.entries(keys)
  if (entradas.length === 0) {
    throw new Error(
      'Esta tabela não tem chave primária, então não é possível identificar a linha com segurança. ' +
        'Edite pelo editor de SQL, com um WHERE que você controle.'
    )
  }
  if (entradas.some(([, valor]) => valor === null || valor === undefined)) {
    throw new Error('A chave primária desta linha está nula — não dá para identificá-la com segurança.')
  }
  return entradas
}
