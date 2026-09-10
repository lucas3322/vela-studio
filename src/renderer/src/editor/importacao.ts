import type { ColumnInfo, ColunaDoArquivo, MapeamentoDeColuna, TipoDeduzido } from '@shared/types'

/**
 * Regra pura da importação de arquivo para tabela.
 *
 * Nada aqui toca em IPC nem em estado de componente — só casamento de nome,
 * julgamento de compatibilidade de tipo e a regra da chave auto-incremento.
 * O `ImportDialog` chama estas funções; elas não sabem que ele existe. É o
 * que permite testar a parte que decide sem abrir uma janela.
 */

/**
 * Normaliza um nome de coluna para comparação tolerante: sem acento, sem
 * diferença de caixa, sem diferença entre `snake_case` e `camelCase`.
 *
 * Remover todo separador (`_`, espaço, hífen) e comparar só as letras/números
 * restantes cobre os três casos de uma vez — `criado_em`, `CriadoEm` e
 * `Criado Em` viram a mesma chave, `criadoem`.
 */
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Casamento automático das colunas do arquivo com as colunas da tabela, por
 * nome normalizado. Cada coluna da tabela só recebe uma coluna do arquivo —
 * a primeira que casar — para não haver dois "de→para" apontando para o
 * mesmo destino sem a pessoa ter escolhido isso.
 *
 * Coluna do arquivo sem par vira `destino: null` (ignorar), que é o padrão
 * seguro: melhor deixar de fora do que adivinhar errado.
 */
export function casarColunas(
  colunasArquivo: ColunaDoArquivo[],
  colunasTabela: ColumnInfo[]
): MapeamentoDeColuna[] {
  const usados = new Set<string>()
  return colunasArquivo.map((colunaArquivo) => {
    const alvo = normalizarNome(colunaArquivo.nome)
    const achada = colunasTabela.find(
      (coluna) => !usados.has(coluna.name) && normalizarNome(coluna.name) === alvo
    )
    if (achada) usados.add(achada.name)
    return { origem: colunaArquivo.indice, destino: achada?.name ?? null }
  })
}

/**
 * Coluna preenchida sozinha pelo banco — auto-incremento, `IDENTITY`,
 * `GENERATED`. `InsertRowDialog` tem a mesma checagem para não pedir essas
 * colunas no formulário de nova linha; aqui a origem é o mesmo `extra` do
 * catálogo, então a regra vive num lugar só e os dois componentes a importam.
 */
export function colunaAutomatica(coluna: ColumnInfo): boolean {
  const extra = (coluna.extra ?? '').toLowerCase()
  return extra.includes('auto_increment') || extra.includes('identity') || extra.includes('generated')
}

/**
 * Aplica a regra da chave auto-incremento a um mapeamento já casado.
 *
 * Padrão (`usarIdsDoArquivo` falso): a coluna do arquivo que bateria com a
 * chave automática é desmarcada — ela **não** é obrigatória no mapeamento, e
 * o banco gera o próprio id. É a decisão seletiva; ver o comentário de
 * `OpcoesDeImportacao.usarIdsDoArquivo` em `shared/types.ts` para o porquê:
 * mandar id explícito colide com linha existente e deixa a sequência do
 * PostgreSQL para trás, um estouro de chave duplicada que aparece bem depois,
 * longe daqui.
 *
 * Quando a pessoa liga o opt-in, a coluna do arquivo correspondente por nome
 * volta a apontar para a chave — sem essa reaplicação, ligar a caixa não
 * teria efeito nenhum se o casamento inicial já tivesse sido descartado.
 */
export function aplicarRegraDeChaveAutomatica(
  mapeamento: MapeamentoDeColuna[],
  colunasArquivo: ColunaDoArquivo[],
  colunasTabela: ColumnInfo[],
  usarIdsDoArquivo: boolean
): MapeamentoDeColuna[] {
  const chave = colunasTabela.find(colunaAutomatica)
  if (!chave) return mapeamento

  if (!usarIdsDoArquivo) {
    return mapeamento.map((m) => (m.destino === chave.name ? { ...m, destino: null } : m))
  }

  const alvo = normalizarNome(chave.name)
  const colunaDoArquivo = colunasArquivo.find((c) => normalizarNome(c.nome) === alvo)
  if (!colunaDoArquivo) return mapeamento

  return mapeamento.map((m) => (m.origem === colunaDoArquivo.indice ? { ...m, destino: chave.name } : m))
}

/**
 * Colunas obrigatórias (sem `NULL`, sem `DEFAULT`, não automáticas) que
 * ficaram sem nenhuma coluna do arquivo apontando para elas.
 *
 * Mesma regra do formulário de nova linha em `InsertRowDialog` — lá é "campo
 * vazio", aqui é "sem mapeamento", mas o motivo de bloquear é idêntico: o
 * banco vai recusar a linha porque não há valor nem padrão para essa coluna.
 */
export function colunasObrigatoriasSemMapeamento(
  colunasTabela: ColumnInfo[],
  mapeamento: MapeamentoDeColuna[]
): ColumnInfo[] {
  const destinosMapeados = new Set(
    mapeamento.filter((m) => m.destino != null).map((m) => m.destino)
  )
  return colunasTabela.filter(
    (coluna) =>
      !coluna.nullable &&
      coluna.defaultValue == null &&
      !colunaAutomatica(coluna) &&
      !destinosMapeados.has(coluna.name)
  )
}

export type VeredictoDeCompatibilidade = 'compativel' | 'convertivel' | 'incompativel'

export interface Compatibilidade {
  veredito: VeredictoDeCompatibilidade
  motivo: string
}

type CategoriaDeColuna =
  | 'inteiro'
  | 'decimal'
  | 'texto'
  | 'data'
  | 'booleano'
  | 'json'
  | 'binario'
  | 'desconhecido'

/**
 * Classifica o tipo cru do banco (`varchar(255)`, `bigint unsigned`,
 * `character varying`, `timestamp without time zone`…) numa categoria
 * grosseira, só o bastante para julgar compatibilidade com o tipo deduzido do
 * arquivo. Não tenta ser um parser de tipo completo — cada dialeto tem
 * dezenas de grafias, e a pergunta aqui é só "isso é número, texto, data,
 * booleano, json ou binário".
 *
 * Casa pela **primeira palavra** do tipo, não por substring: `geography` não
 * pode virar "inteiro" só porque contém `int` dentro de `point`, e é
 * exatamente esse tipo de acidente que um `/int/.test()` cometeria.
 */
function categoriaDaColuna(tipoBanco: string): CategoriaDeColuna {
  const cru = tipoBanco.toLowerCase().trim()
  // MySQL usa tinyint(1) como convenção de booleano — checa antes da regra
  // geral, senão cairia em inteiro.
  if (/tinyint\s*\(\s*1\s*\)/.test(cru)) return 'booleano'

  const base = cru.split(/[\s(]/)[0]

  const BOOLEANO = new Set(['bool', 'boolean'])
  const JSON_ = new Set(['json', 'jsonb'])
  const INTEIRO = new Set([
    'int', 'int2', 'int4', 'int8', 'integer', 'smallint', 'bigint', 'tinyint',
    'mediumint', 'serial', 'bigserial', 'smallserial', 'year'
  ])
  const DECIMAL = new Set(['decimal', 'numeric', 'float', 'float4', 'float8', 'double', 'real', 'money'])
  const DATA = new Set([
    'date', 'datetime', 'timestamp', 'timestamptz', 'time', 'timetz', 'interval'
  ])
  const BINARIO = new Set([
    'blob', 'bytea', 'binary', 'varbinary', 'longblob', 'mediumblob', 'tinyblob', 'bit'
  ])
  const TEXTO_EXATO = new Set(['uuid', 'enum', 'inet', 'objectid', 'string', 'set', 'citext', 'character'])

  if (BOOLEANO.has(base)) return 'booleano'
  if (JSON_.has(base)) return 'json'
  if (INTEIRO.has(base)) return 'inteiro'
  if (DECIMAL.has(base)) return 'decimal'
  if (DATA.has(base)) return 'data'
  if (BINARIO.has(base)) return 'binario'
  if (TEXTO_EXATO.has(base) || base.endsWith('char') || base.endsWith('text')) return 'texto'
  return 'desconhecido'
}

type Matriz = Record<Exclude<TipoDeduzido, 'vazio'>, Record<CategoriaDeColuna, Compatibilidade>>

const DESCONHECIDO: Compatibilidade = {
  veredito: 'convertivel',
  motivo: 'Tipo da coluna não reconhecido automaticamente — confira manualmente.'
}

const MATRIZ: Matriz = {
  inteiro: {
    inteiro: { veredito: 'compativel', motivo: 'Inteiro do arquivo cabe direto na coluna.' },
    decimal: { veredito: 'compativel', motivo: 'Inteiro cabe sem perda numa coluna decimal.' },
    texto: { veredito: 'convertivel', motivo: 'O número vira texto na gravação.' },
    booleano: {
      veredito: 'convertivel',
      motivo: '0 e 1 podem virar verdadeiro/falso — confira os exemplos.'
    },
    data: { veredito: 'incompativel', motivo: 'Número não vira data automaticamente.' },
    json: { veredito: 'convertivel', motivo: 'Entra como valor numérico dentro do JSON.' },
    binario: { veredito: 'incompativel', motivo: 'Número não converte para binário.' },
    desconhecido: DESCONHECIDO
  },
  decimal: {
    inteiro: { veredito: 'convertivel', motivo: 'Perde as casas decimais ao gravar como inteiro.' },
    decimal: { veredito: 'compativel', motivo: 'Decimal do arquivo cabe direto na coluna.' },
    texto: { veredito: 'convertivel', motivo: 'O número vira texto na gravação.' },
    booleano: { veredito: 'incompativel', motivo: 'Número decimal não vira verdadeiro/falso.' },
    data: { veredito: 'incompativel', motivo: 'Número não vira data automaticamente.' },
    json: { veredito: 'convertivel', motivo: 'Entra como valor numérico dentro do JSON.' },
    binario: { veredito: 'incompativel', motivo: 'Número não converte para binário.' },
    desconhecido: DESCONHECIDO
  },
  booleano: {
    booleano: {
      veredito: 'compativel',
      motivo: 'Verdadeiro/falso do arquivo cabe direto na coluna.'
    },
    inteiro: { veredito: 'convertivel', motivo: 'Verdadeiro/falso grava como 1/0.' },
    decimal: { veredito: 'incompativel', motivo: 'Verdadeiro/falso não vira número decimal.' },
    texto: { veredito: 'convertivel', motivo: "Grava como o texto 'true'/'false'." },
    data: { veredito: 'incompativel', motivo: 'Verdadeiro/falso não vira data.' },
    json: { veredito: 'convertivel', motivo: 'Entra como valor booleano dentro do JSON.' },
    binario: { veredito: 'incompativel', motivo: 'Verdadeiro/falso não converte para binário.' },
    desconhecido: DESCONHECIDO
  },
  data: {
    data: { veredito: 'compativel', motivo: 'Data do arquivo cabe direto na coluna.' },
    texto: {
      veredito: 'convertivel',
      motivo: 'A data vira texto; o formato precisa bater com o que o banco espera.'
    },
    inteiro: { veredito: 'incompativel', motivo: 'Data não vira número inteiro.' },
    decimal: { veredito: 'incompativel', motivo: 'Data não vira número decimal.' },
    booleano: { veredito: 'incompativel', motivo: 'Data não vira verdadeiro/falso.' },
    json: { veredito: 'convertivel', motivo: 'Entra como texto de data dentro do JSON.' },
    binario: { veredito: 'incompativel', motivo: 'Data não converte para binário.' },
    desconhecido: DESCONHECIDO
  },
  texto: {
    texto: { veredito: 'compativel', motivo: 'Texto do arquivo cabe direto na coluna.' },
    inteiro: {
      veredito: 'incompativel',
      motivo: 'O arquivo tem texto que não é um número inteiro.'
    },
    decimal: { veredito: 'incompativel', motivo: 'O arquivo tem texto que não é um número.' },
    booleano: {
      veredito: 'incompativel',
      motivo: 'O arquivo tem texto que não é verdadeiro/falso.'
    },
    data: {
      veredito: 'incompativel',
      motivo: 'O arquivo tem texto que não foi reconhecido como data.'
    },
    json: {
      veredito: 'convertivel',
      motivo: 'Precisa ser um JSON válido, senão o banco recusa a linha.'
    },
    binario: {
      veredito: 'convertivel',
      motivo: 'Grava como binário cru — confira a codificação.'
    },
    desconhecido: DESCONHECIDO
  }
}

/**
 * Veredito de compatibilidade entre o tipo deduzido de uma coluna do arquivo
 * e o tipo real de uma coluna da tabela, com o motivo em português para a
 * pessoa ler antes de confirmar o mapeamento.
 *
 * `vazio` (amostra sem valor nenhum) é sempre compatível: não há o que
 * contestar sobre um tipo que a amostra não revelou. Isso não dispensa a
 * coluna de ser obrigatória — essa é outra checagem, `colunasObrigatoriasSemMapeamento`.
 */
export function compatibilidade(tipoDeduzido: TipoDeduzido, tipoDaColuna: string): Compatibilidade {
  if (tipoDeduzido === 'vazio') {
    return { veredito: 'compativel', motivo: 'A amostra não tinha valor para conferir o tipo.' }
  }
  const categoria = categoriaDaColuna(tipoDaColuna)
  return MATRIZ[tipoDeduzido][categoria]
}
