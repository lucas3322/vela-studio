import type {
  ColumnInfo,
  ConnectionConfig,
  Dialect,
  IndexInfo,
  QueryResult,
  RelationInfo,
  SchemaRelation,
  TableInfo,
  TestResult
} from '../../shared/types'

// As regras de forma do SQL vivem em `shared/sql-shape.ts`, não aqui: o
// renderer também precisa delas para avisar antes de um comando sem WHERE, e
// ele não pode importar de `main/`. Importe de lá.

export interface QueryOptions {
  /** Identificador para cancelamento. */
  queryId: string
  database?: string
  /** Teto de linhas trazidas pro renderer. Acima disso cortamos e avisamos. */
  maxRows?: number
  /**
   * Teto para quando a consulta **não** declara LIMIT.
   *
   * Separado do `maxRows` de propósito: `maxRows` é um teto que o chamador
   * impõe custe o que custar (a exportação usa isso), enquanto este é só o
   * padrão de quem não pediu limite nenhum. Espremer os dois num campo só fez
   * um `LIMIT 50000` escrito pelo usuário ser cortado em 100 — o valor da
   * preferência vencia o comando dele.
   */
  previewRows?: number
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

  /**
   * Todas as chaves estrangeiras do banco, de uma vez.
   *
   * Existe porque `listRelations` é por tabela, e a modelagem precisa do mapa
   * inteiro: num CRM de 211 tabelas isso seriam 211 idas ao banco só para
   * desenhar a primeira tela. Nos bancos com catálogo (MySQL, PostgreSQL) é
   * **uma** consulta; no SQLite é um pragma por tabela, mas o arquivo é local.
   *
   * Quem não tem FK declarada devolve lista vazia — e a UI diz isso em vez de
   * mostrar um diagrama vazio como se o schema não tivesse ligação nenhuma.
   */
  listAllRelations(database?: string): Promise<SchemaRelation[]>

  /**
   * Percorre o resultado em blocos, sem materializar tudo na memória.
   *
   * Existe por causa da exportação. O caminho normal (`query`) devolve um
   * array inteiro e é limitado de propósito, para a grade não travar. Isso
   * está certo para exibir e **errado para exportar**: numa tabela de 250 mil
   * linhas, o arquivo saía com 100 e a IDE dizia "salvo" em verde.
   *
   * Quem implementa DEVE entregar os blocos conforme o banco entrega, sem
   * acumular — o ponto todo é conseguir escrever milhões de linhas em disco
   * com memória constante.
   *
   * `aoReceber` é aguardado entre blocos: é assim que a contrapressão da
   * escrita em disco chega até a leitura do banco.
   */
  streamQuery(
    sql: string,
    options: { database?: string },
    aoReceber: (bloco: { columns: string[]; rows: unknown[][] }) => Promise<void>
  ): Promise<void>

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

  /**
   * Insere uma linha.
   *
   * Mesmas garantias do `updateCell`: recusa em conexão somente-leitura e usa
   * consulta parametrizada. Concatenar valor no SQL aqui seria pior do que no
   * UPDATE — quem insere está digitando texto livre em todas as colunas de uma
   * vez, e uma aspa no meio de um nome viraria comando.
   *
   * Colunas ausentes de `values` não entram no INSERT: é assim que o banco
   * aplica o `DEFAULT` e o auto-incremento. Mandar `NULL` numa coluna
   * auto-incremento funcionaria por acaso no MySQL e falharia no PostgreSQL.
   */
  insertRow(params: {
    table: string
    database?: string
    values: Record<string, unknown>
  }): Promise<{ affectedRows: number; statement: string }>

  /**
   * Insere MUITAS linhas de uma vez — o caminho da importação de arquivo.
   *
   * Existe separado do `insertRow` por causa do custo: um arquivo de 200 mil
   * linhas por `insertRow` são 200 mil idas ao banco, e a importação levaria
   * horas. Aqui as linhas vão em lotes, num INSERT de vários `VALUES`, ainda
   * **parametrizado** — o valor nunca é concatenado no SQL.
   *
   * `columns` fixa a ordem: cada linha de `rows` é lida por posição, então
   * quem chama já resolveu o mapeamento arquivo→tabela. Coluna que o arquivo
   * não preenche simplesmente não entra em `columns`, e o banco aplica o
   * `DEFAULT`/auto-incremento — a mesma regra do `insertRow`.
   *
   * Implementações DEVEM recusar conexão somente-leitura e rodar o lote em
   * transação: meio lote gravado é pior do que lote nenhum, porque ninguém
   * sabe onde parou.
   */
  insertRows(params: {
    table: string
    database?: string
    columns: string[]
    rows: unknown[][]
  }): Promise<{ affectedRows: number }>

  /**
   * Reajusta a sequência da chave depois de uma importação com ids explícitos.
   *
   * Só o PostgreSQL precisa: lá o `INSERT` com id explícito **não** avança a
   * sequência, e o próximo insert normal do sistema estoura com chave
   * duplicada — longe da importação, sem ninguém ligar uma coisa à outra. No
   * MySQL e no SQLite o auto-incremento se ajusta sozinho, então eles
   * devolvem `undefined` e não fazem nada.
   *
   * Devolve o nome da sequência quando reajustou, para o relato dizer o que
   * foi feito em vez de fazer escondido.
   */
  resyncSequence(params: {
    table: string
    database?: string
    column: string
  }): Promise<string | undefined>

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

/**
 * Linhas por bloco na exportação em fluxo.
 *
 * Grande o bastante para não pagar uma ida ao banco a cada punhado de linhas,
 * pequeno o bastante para a memória ficar constante: o pico é um bloco, não a
 * consulta inteira.
 */
export const LOTE_EXPORTACAO = 5_000

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

/**
 * Divide as linhas em sub-lotes de modo que nenhum INSERT ultrapasse o teto
 * de parâmetros do banco.
 *
 * Cada linha gasta exatamente `columns` placeholders — um `INSERT ... VALUES
 * (?,?,?), (?,?,?), ...` com 20 colunas e 5.000 linhas do lote pedido pela
 * importação estouraria os 65.535 parâmetros de uma prepared statement do
 * MySQL/PostgreSQL, ou os 999 de um SQLite mais antigo, bem antes de chegar
 * lá. Cada driver chama isto com o teto que vale para ele.
 *
 * Uma única linha cujo número de colunas já ultrapasse o teto (tabela muito
 * larga) ainda sai como lote de 1 — é a única opção honesta; cortar colunas
 * por conta própria inventaria dado que a pessoa não pediu.
 */
export function chunkForPlaceholders<T>(rows: T[], columns: number, maxPlaceholders: number): T[][] {
  if (rows.length === 0) return []
  const perChunk = Math.max(1, Math.floor(maxPlaceholders / Math.max(1, columns)))
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += perChunk) {
    chunks.push(rows.slice(i, i + perChunk))
  }
  return chunks
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
