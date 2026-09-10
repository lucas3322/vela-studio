/**
 * Contrato único entre main, preload e renderer.
 * Se um tipo atravessa o IPC, ele mora aqui.
 */

export type DriverId = 'mysql' | 'postgres' | 'sqlite' | 'mongodb' | 'redis'

/** Dialeto usado pelo editor para escolher keywords, funções e regras de citação. */
export type Dialect = 'mysql' | 'postgres' | 'sqlite' | 'mongodb' | 'redis'

export interface ConnectionConfig {
  id: string
  name: string
  driver: DriverId
  color?: string
  /** Host e porta — não usado por sqlite. */
  host?: string
  port?: number
  user?: string
  /** Nunca persistido em texto puro: o main criptografa com safeStorage. */
  password?: string
  database?: string
  /** Caminho do arquivo .db — só sqlite. */
  filePath?: string
  /** String de conexão completa — alternativa para mongodb e postgres. */
  connectionString?: string
  ssl?: boolean
  /** Bloqueia qualquer statement que escreva. */
  readOnly?: boolean
  createdAt?: number
  lastUsedAt?: number
}

/** O que fica salvo em disco: igual ao config, mas com a senha já cifrada. */
export interface StoredConnection extends Omit<ConnectionConfig, 'password'> {
  encryptedPassword?: string
  /**
   * Só na listagem enviada ao renderer. Diz se existe senha guardada sem
   * expor o texto cifrado — a UI precisa saber para pedir a senha antes de
   * tentar conectar, em vez de falhar com "Access denied" do banco.
   */
  hasPassword?: boolean
  /**
   * Explicação de por que a senha não foi guardada, quando não foi.
   *
   * Só aparece na resposta do `save` — nunca é persistido. Guardar a senha
   * pode falhar (chaveiro bloqueado, acesso negado) sem que isso impeça de
   * conectar, e o usuário precisa saber disso sem virar um erro que trava.
   */
  passwordWarning?: string
}

export interface TableInfo {
  name: string
  schema?: string
  /** Mongo usa 'collection'; SQL usa table/view. */
  type: 'table' | 'view' | 'collection'
  rowCount?: number
}

export interface ColumnInfo {
  name: string
  /** Tipo cru do banco: `varchar(255)`, `int`, `jsonb`, `ObjectId`… */
  type: string
  nullable: boolean
  defaultValue?: string | null
  isPrimaryKey: boolean
  isForeignKey?: boolean
  comment?: string | null
  extra?: string | null
  /** Só Mongo: em quantos % dos documentos amostrados o campo apareceu. */
  frequency?: number
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary?: boolean
}

export interface RelationInfo {
  constraintName: string
  column: string
  referencedTable: string
  referencedColumn: string
  onDelete?: string
  onUpdate?: string
}

/**
 * Uma chave estrangeira vista de fora da tabela — inclui de onde ela sai.
 *
 * `RelationInfo` basta quando já se sabe qual tabela foi consultada. A
 * modelagem lê o schema inteiro de uma vez, então precisa da ponta de origem
 * junto: sem ela, 211 listas de relação viram um monte indistinguível.
 */
export interface SchemaRelation extends RelationInfo {
  /** Tabela que declara a FK. */
  table: string
}

export interface QueryColumn {
  name: string
  /** Tipo inferido para alinhamento e formatação no grid. */
  type: 'number' | 'string' | 'boolean' | 'date' | 'json' | 'binary' | 'null'
}

export interface QueryResult {
  /** Cada statement do lote vira um resultado. */
  columns: QueryColumn[]
  rows: unknown[][]
  rowCount: number
  affectedRows?: number
  /** Milissegundos medidos no main, incluindo ida e volta ao banco. */
  durationMs: number
  /** Preenchido quando a IDE cortou o resultado por segurança. */
  truncatedAt?: number
  /** Texto do statement que gerou esse resultado. */
  statement: string
}

export interface QueryError {
  /** Mensagem crua do driver — útil pra quem sabe o que está fazendo. */
  raw: string
  /** Mensagem reescrita em português, quando reconhecemos o código. */
  friendly: string
  /** Sugestão acionável: "você quis dizer `contracts`?" */
  hint?: string
  code?: string
  /** Posição 0-based no texto da query, quando o banco informa. */
  position?: number
}

export interface QueryRunResult {
  results: QueryResult[]
  error?: QueryError
}

export interface SchemaSnapshot {
  connectionId: string
  database: string
  tables: TableInfo[]
  /** Colunas por nome de tabela — o que alimenta o autocomplete. */
  columns: Record<string, ColumnInfo[]>
  loadedAt: number
}

export interface ConnectionStatus {
  connected: boolean
  connectionId?: string
  database?: string
  serverVersion?: string
  message?: string
}

export interface TestResult {
  ok: boolean
  message: string
  serverVersion?: string
  latencyMs?: number
}

/** Metadados de cada driver, usados pra montar o formulário de conexão. */
export interface DriverMeta {
  id: DriverId
  label: string
  dialect: Dialect
  defaultPort?: number
  family: 'sql' | 'nosql'
  /** Campos que o formulário deve mostrar. */
  fields: Array<'host' | 'port' | 'user' | 'password' | 'database' | 'filePath' | 'connectionString' | 'ssl'>
  accent: string
}

export const DRIVERS: Record<DriverId, DriverMeta> = {
  mysql: {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    dialect: 'mysql',
    defaultPort: 3306,
    family: 'sql',
    fields: ['host', 'port', 'user', 'password', 'database', 'ssl'],
    accent: '#00758f'
  },
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    dialect: 'postgres',
    defaultPort: 5432,
    family: 'sql',
    fields: ['host', 'port', 'user', 'password', 'database', 'ssl', 'connectionString'],
    accent: '#336791'
  },
  sqlite: {
    id: 'sqlite',
    label: 'SQLite',
    dialect: 'sqlite',
    family: 'sql',
    fields: ['filePath'],
    accent: '#0f80cc'
  },
  mongodb: {
    id: 'mongodb',
    label: 'MongoDB',
    dialect: 'mongodb',
    defaultPort: 27017,
    family: 'nosql',
    fields: ['connectionString', 'host', 'port', 'user', 'password', 'database'],
    accent: '#00ed64'
  },
  redis: {
    id: 'redis',
    label: 'Redis',
    dialect: 'redis',
    defaultPort: 6379,
    family: 'nosql',
    // `database` aqui é o índice numérico do banco Redis (0-15), não um nome —
    // o formulário precisa rotular o campo de forma diferente para este driver.
    fields: ['connectionString', 'host', 'port', 'user', 'password', 'database', 'ssl'],
    accent: '#dc382d'
  }
}

/**
 * Identificação de uma linha para edição.
 *
 * `keys` são as colunas da chave primária com seus valores atuais. Sem chave
 * primária a edição é recusada: um UPDATE cuja cláusula WHERE não isola uma
 * linha pode reescrever a tabela inteira, e não há desfazer.
 */
export interface RowKeys {
  [coluna: string]: unknown
}

export interface EditCellParams {
  connectionId: string
  table: string
  database?: string
  column: string
  value: unknown
  keys: RowKeys
}

export interface InsertRowParams {
  connectionId: string
  table: string
  database?: string
  /** Só as colunas preenchidas. As de fora recebem o DEFAULT do banco. */
  values: Record<string, unknown>
}

export interface DeleteRowParams {
  connectionId: string
  table: string
  database?: string
  keys: RowKeys
}

export interface EditResult {
  affectedRows: number
  /** SQL efetivamente executado, para o histórico e para quem quiser conferir. */
  statement: string
}

export interface HistoryEntry {
  id: string
  connectionId: string
  connectionName: string
  database?: string
  sql: string
  ok: boolean
  rowCount?: number
  durationMs?: number
  executedAt: number
}

/**
 * Resultado da checagem de atualização.
 *
 * `sem-arquivo` é um estado próprio de propósito: existe versão nova, mas
 * nenhum instalador para esta plataforma/arquitetura. Oferecer o arquivo
 * errado já custou caro neste projeto — um DMG arm64 com binário x86_64
 * dentro abre como "app danificado". Melhor dizer que falta o arquivo.
 */
export interface UpdateInfo {
  status: 'atual' | 'disponivel' | 'sem-arquivo' | 'erro'
  versaoAtual: string
  versaoNova?: string
  /** Corpo da release no GitHub, em markdown cru. */
  notas?: string
  publicadoEm?: string
  /** URL do instalador certo para esta plataforma. Ausente em `sem-arquivo`. */
  downloadUrl?: string
  nomeArquivo?: string
  tamanhoBytes?: number
  /** Página da release — o caminho de saída quando o download automático não serve. */
  paginaUrl?: string
  mensagem?: string
}

export interface UpdateProgress {
  recebidoBytes: number
  totalBytes: number
}

/**
 * Query guardada pelo usuário.
 *
 * Fica atrelada a uma conexão porque uma query escrita para o Postgres
 * raramente roda no Mongo — mostrar todas juntas viraria uma lista de coisas
 * que quebram ao clicar. A UI ainda permite ver as de outras conexões, mas o
 * padrão é o contexto atual.
 */
export interface SavedQuery {
  id: string
  name: string
  sql: string
  connectionId: string
  database?: string
  createdAt: number
  updatedAt: number
}

/* ── Importação de arquivo para dentro de uma tabela ──────────────────
 *
 * O caminho inverso da exportação. Duas formas bem diferentes de arquivo,
 * então dois modos no mesmo fluxo:
 *
 * - **CSV**: o arquivo tem colunas próprias, que precisam ser casadas com as
 *   colunas da tabela. É aqui que vive a prévia, a checagem de tipo e o
 *   remapeamento.
 * - **SQL** (dump de `INSERT`): os comandos já dizem para onde vão. Não há o
 *   que mapear — há o que **conferir antes de executar**, porque um dump roda
 *   comando arbitrário no banco.
 */

export type FormatoDeImportacao = 'csv' | 'sql'

/** Tipo deduzido por amostragem — palpite sobre o arquivo, nunca sobre o banco. */
export type TipoDeduzido = 'inteiro' | 'decimal' | 'booleano' | 'data' | 'texto' | 'vazio'

/** Uma coluna do arquivo (CSV). */
export interface ColunaDoArquivo {
  /** Cabeçalho, ou `coluna N` quando o arquivo não tem cabeçalho. */
  nome: string
  /** Posição no arquivo, base 0 — é por ela que o mapeamento aponta. */
  indice: number
  tipoDeduzido: TipoDeduzido
  /** Amostra de valores, para a pessoa conferir com o olho. */
  exemplos: string[]
}

/**
 * O que a prévia devolve.
 *
 * `truncada` existe para a interface poder dizer a verdade: a prévia são as
 * primeiras linhas, não o arquivo. "Está tudo certo nas 100 primeiras" não é
 * "está tudo certo" — e prometer o segundo é o tipo de engano que este projeto
 * já pagou caro.
 */
export interface PreviaDeImportacao {
  formato: FormatoDeImportacao
  caminho: string
  tamanhoBytes: number
  /** CSV: colunas detectadas. Vazio em SQL. */
  colunas: ColunaDoArquivo[]
  /** CSV: primeiras linhas, já divididas por coluna. */
  linhas: string[][]
  /** CSV: delimitador detectado (`,`, `;`, tab). */
  delimitador?: string
  /** CSV: a primeira linha parece ser cabeçalho? */
  temCabecalho?: boolean
  /** SQL: o que foi encontrado na leitura da prévia. */
  sql?: {
    /** Comandos lidos na prévia. */
    comandos: number
    /** Quantos deles são INSERT. */
    inserts: number
    /** Comandos que NÃO são INSERT — o que exige confirmação consciente. */
    outros: string[]
    primeiros: string[]
  }
  /** A prévia parou antes do fim do arquivo. */
  truncada: boolean
}

/** De→para de uma coluna do arquivo para uma coluna da tabela. */
export interface MapeamentoDeColuna {
  /** Índice da coluna no arquivo. */
  origem: number
  /** Coluna de destino; `null` significa **ignorar** esta coluna do arquivo. */
  destino: string | null
}

export interface OpcoesDeImportacao {
  /** CSV: pular a primeira linha (cabeçalho). */
  ignorarPrimeiraLinha: boolean
  delimitador?: string
  /**
   * Gravar os valores do arquivo nas colunas de chave auto-incremento.
   *
   * Padrão **falso**, e não por preguiça: mandar id explícito para uma coluna
   * auto-incremento colide com linha existente e, no PostgreSQL, não avança a
   * sequência — o próximo INSERT normal do sistema estoura com chave
   * duplicada, longe daqui, sem ninguém ligar uma coisa à outra. Quando a
   * pessoa liga isso de propósito, o import reajusta a sequência no fim.
   */
  usarIdsDoArquivo: boolean
  /** Linhas por lote no INSERT. */
  tamanhoDoLote?: number
}

/** Relato honesto do que entrou e do que não entrou. */
export interface ResultadoDaImportacao {
  linhasLidas: number
  linhasGravadas: number
  /** Falhas linha a linha, com o número da linha **no arquivo**. */
  falhas: Array<{ linha: number; motivo: string }>
  /** Falhas que não couberam no relato, para não estourar a memória. */
  falhasOmitidas: number
  /** Sequência reajustada no fim (só PostgreSQL, com `usarIdsDoArquivo`). */
  sequenciaReajustada?: string
}

/** Andamento da importação, emitido pelo main. */
export interface ImportProgress {
  lidas: number
  gravadas: number
  /** Bytes já consumidos do arquivo e o total — dá porcentagem honesta. */
  bytesLidos: number
  bytesTotais: number
}

/**
 * Andamento da exportação.
 *
 * `totalEstimado` é opcional de propósito: a exportação em fluxo não sabe
 * quantas linhas vêm por aí. Quando quem chamou tem uma estimativa (a
 * contagem do catálogo, no caso da tabela), ela vem aqui e a interface mostra
 * porcentagem — rotulada como estimativa, porque é o que é. Sem ela, a barra
 * fica indeterminada e o número de linhas gravadas é o único fato.
 */
export interface ExportProgress {
  linhas: number
  arquivos: number
  totalEstimado?: number
}
