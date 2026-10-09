/**
 * Leitura de um documento do MongoDB para a visão de documento.
 *
 * O documento chega em EJSON — a notação do próprio Mongo, onde o ObjectId é
 * `{ "$oid": … }` e a data é `{ "$date": … }`. Sem ela, os dois chegariam como
 * texto puro e a tela não teria como saber a diferença entre um ObjectId e uma
 * string de 24 caracteres que por acaso parece um.
 *
 * Aqui esse EJSON vira algo que a interface desenha: um tipo, um texto e, para
 * objeto e lista, os filhos já interpretados.
 */

import { deslocamentoComoTexto, deslocamentoEm, formatarInstante } from '../../../shared/datas.ts'

export type TipoDeValor =
  | 'objectid'
  | 'data'
  | 'numero'
  | 'texto'
  | 'booleano'
  | 'nulo'
  | 'objeto'
  | 'lista'
  | 'binario'
  | 'regex'
  | 'codigo'

/**
 * Um pedaço do valor escrito como o shell do Mongo o escreve.
 *
 * `funcao` é o construtor do BSON (`ObjectId(`, `)`), `texto` é o que vai
 * entre aspas, e o resto tem o nome do próprio tipo. A tela pinta cada classe
 * com a cor que um editor de JSON daria a ela.
 */
export interface PedacoLiteral {
  classe: 'funcao' | 'texto' | 'numero' | 'booleano' | 'nulo' | 'data' | 'regex'
  texto: string
}

export interface CampoDoDocumento {
  chave: string
  valor: ValorDoDocumento
}

export interface ValorDoDocumento {
  tipo: TipoDeValor
  /** O que se lê na linha. */
  texto: string
  /**
   * Texto longo do valor, para o `title`.
   *
   * Existe por causa da data: a linha mostra `2023-06-06 14:07:47`, igual à
   * grade, e o instante completo com fuso fica a um hover de distância. Cortar
   * sem deixar o original em lugar nenhum seria esconder que aquilo é UTC.
   */
  detalhe?: string
  /** Só em objeto e lista. */
  filhos?: CampoDoDocumento[]
  /**
   * O valor como literal do shell: `ObjectId("…")`, `ISODate("…")`,
   * `"texto"`. É o que a visão de documento desenha — a forma que quem usa
   * Mongo lê todo dia no mongosh, no Compass e no Studio 3T. Ausente em
   * objeto e lista, que viram estrutura.
   */
  literal?: PedacoLiteral[]
}

/** Um objeto EJSON tem exatamente uma chave, e ela começa com `$`. */
function marcador(valor: object): string | null {
  const chaves = Object.keys(valor)
  if (chaves.length !== 1) return null
  return chaves[0].startsWith('$') ? chaves[0] : null
}

function comoTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor
  // `{ "$date": { "$numberLong": "…" } }` acontece com data fora da faixa que
  // o ISO representa. Vale mais mostrar o número do que "[object Object]".
  if (valor && typeof valor === 'object') {
    const dentro = Object.values(valor as Record<string, unknown>)[0]
    return String(dentro)
  }
  return String(valor)
}

/**
 * A data no mesmo relógio em que a grade a mostra: o fuso da conexão.
 *
 * As duas telas têm que concordar. Antes as duas mostravam UTC sem dizer — e a
 * pessoa lia como hora de Brasília. Agora as duas mostram o fuso da conexão
 * (o do computador, por padrão), e o instante exato em UTC fica no `detalhe`,
 * a um hover de distância.
 */
function dataLegivel(iso: string, fuso: string): string {
  const instante = new Date(iso)
  return Number.isNaN(instante.getTime()) ? iso : formatarInstante(instante, fuso)
}

/**
 * A data como `ISODate` com o deslocamento do fuso escrito por extenso.
 *
 * O `ISODate` do shell é sempre UTC (`…Z`). Mostrar a hora local dentro dele
 * sem o deslocamento seria mentir: quem lê `ISODate("2025-03-01T09:30:00")`
 * entende 09:30 em UTC. Com `-03:00` no fim, o mesmo instante aparece no
 * relógio da pessoa e continua sendo uma data ISO válida, que ela pode colar
 * de volta num filtro.
 */
export function isoNoFuso(iso: string, fuso: string): string {
  const instante = new Date(iso)
  if (Number.isNaN(instante.getTime())) return iso
  const minutos = deslocamentoEm(fuso, instante)
  const relogio = formatarInstante(instante, fuso).replace(' ', 'T')
  return `${relogio}${minutos === 0 ? 'Z' : deslocamentoComoTexto(minutos)}`
}

function construtor(
  nome: string,
  conteudo: string,
  classe: PedacoLiteral['classe'] = 'texto'
): PedacoLiteral[] {
  return [
    { classe: 'funcao', texto: `${nome}(` },
    { classe, texto: JSON.stringify(conteudo) },
    { classe: 'funcao', texto: ')' }
  ]
}

/** O literal de um valor já interpretado. Objeto e lista não têm um. */
function literalDe(valor: ValorDoDocumento, fuso: string): PedacoLiteral[] | undefined {
  switch (valor.tipo) {
    case 'texto':
      return [{ classe: 'texto', texto: JSON.stringify(valor.detalhe ?? '') }]
    case 'objectid':
      return valor.detalhe !== undefined
        ? construtor('ObjectId', valor.detalhe)
        : [{ classe: 'funcao', texto: valor.texto }]
    case 'data':
      // A data por dentro do ISODate leva a cor de data, não a de texto: no
      // olho ela tem que se separar de uma string que só parece data.
      return construtor('ISODate', isoNoFuso(valor.detalhe ?? valor.texto, fuso), 'data')
    case 'numero':
      return valor.detalhe === 'Decimal128'
        ? construtor('Decimal128', valor.texto)
        : [{ classe: 'numero', texto: valor.texto }]
    case 'booleano':
      return [{ classe: 'booleano', texto: valor.texto }]
    case 'nulo':
      return [{ classe: 'nulo', texto: valor.texto }]
    case 'regex':
      return [{ classe: 'regex', texto: valor.texto }]
    case 'binario':
      return construtor('Binary', valor.detalhe ?? '')
    case 'codigo':
      return construtor('Code', valor.texto)
    default:
      return undefined
  }
}

export function interpretarValor(valor: unknown, fuso = 'UTC'): ValorDoDocumento {
  const interpretado = interpretarSemLiteral(valor, fuso)
  const literal = literalDe(interpretado, fuso)
  return literal ? { ...interpretado, literal } : interpretado
}

/** Texto curto do valor dentro de uma prévia — o literal colado, sem cores. */
function textoCurto(valor: ValorDoDocumento): string {
  if (valor.literal) return valor.literal.map((p) => p.texto).join('')
  if (valor.tipo === 'objeto') return valor.filhos?.length ? '{…}' : '{}'
  if (valor.tipo === 'lista') return valor.filhos?.length ? '[…]' : '[]'
  return valor.texto
}

/**
 * A linha de um objeto ou lista recolhidos: `{ "nome": "Ana", "uf": "SP" }`.
 *
 * Recolhido, o objeto dizia só "{ 3 campos }" — quem procura um pedido pelo
 * nome do cliente tinha que abrir um por um. Com a prévia, o começo do
 * conteúdo já está na linha, como no Compass. Objeto dentro de objeto vira
 * `{…}`; o que passa do limite vira `…` no fim.
 */
export function previa(valor: ValorDoDocumento, limite = 72): string {
  const filhos = valor.filhos ?? []
  const lista = valor.tipo === 'lista'
  if (filhos.length === 0) return lista ? '[]' : '{}'

  const [abre, fecha] = lista ? ['[ ', ' ]'] : ['{ ', ' }']
  let corpo = ''
  for (let i = 0; i < filhos.length; i++) {
    const filho = filhos[i]
    const parte = (lista ? '' : `${JSON.stringify(filho.chave)}: `) + textoCurto(filho.valor)
    const proximo = corpo ? `${corpo}, ${parte}` : parte
    if (abre.length + proximo.length + fecha.length > limite) {
      return `${abre}${corpo ? `${corpo}, …` : `${parte.slice(0, Math.max(8, limite - 8))}…`}${fecha}`
    }
    corpo = proximo
  }
  return `${abre}${corpo}${fecha}`
}

function interpretarSemLiteral(valor: unknown, fuso: string): ValorDoDocumento {
  if (valor === null || valor === undefined) return { tipo: 'nulo', texto: 'null' }

  if (typeof valor === 'string') return { tipo: 'texto', texto: `"${valor}"`, detalhe: valor }
  if (typeof valor === 'number') return { tipo: 'numero', texto: String(valor) }
  if (typeof valor === 'boolean') return { tipo: 'booleano', texto: valor ? 'true' : 'false' }

  if (Array.isArray(valor)) {
    const filhos = valor.map((item, indice) => ({
      chave: String(indice),
      valor: interpretarValor(item, fuso)
    }))
    return {
      tipo: 'lista',
      texto: `[ ${valor.length} ${valor.length === 1 ? 'item' : 'itens'} ]`,
      filhos
    }
  }

  if (typeof valor === 'object') {
    const chave = marcador(valor)
    const conteudo = chave ? (valor as Record<string, unknown>)[chave] : undefined

    switch (chave) {
      case '$oid': {
        const id = comoTexto(conteudo)
        return { tipo: 'objectid', texto: `ObjectId('${id}')`, detalhe: id }
      }
      case '$date': {
        const iso = comoTexto(conteudo)
        return { tipo: 'data', texto: dataLegivel(iso, fuso), detalhe: iso }
      }
      case '$numberLong':
      case '$numberInt':
      case '$numberDouble':
        return { tipo: 'numero', texto: comoTexto(conteudo) }
      case '$numberDecimal':
        // Decimal128 fica como texto de propósito: passá-lo por `Number`
        // devolveria um double, que é exatamente a precisão que alguém
        // escolheu não ter ao gravar em decimal.
        return { tipo: 'numero', texto: comoTexto(conteudo), detalhe: 'Decimal128' }
      case '$binary': {
        const dentro = (conteudo ?? {}) as { base64?: string; subType?: string }
        const base64 = dentro.base64 ?? ''
        const curto = base64.length > 24 ? `${base64.slice(0, 24)}…` : base64
        return { tipo: 'binario', texto: `Binary('${curto}')`, detalhe: base64 }
      }
      case '$regularExpression': {
        const dentro = (conteudo ?? {}) as { pattern?: string; options?: string }
        return { tipo: 'regex', texto: `/${dentro.pattern ?? ''}/${dentro.options ?? ''}` }
      }
      case '$timestamp': {
        const dentro = (conteudo ?? {}) as { t?: number; i?: number }
        return { tipo: 'numero', texto: `Timestamp(${dentro.t ?? 0}, ${dentro.i ?? 0})` }
      }
      case '$code':
        return { tipo: 'codigo', texto: comoTexto(conteudo) }
      case '$minKey':
        return { tipo: 'objectid', texto: 'MinKey()' }
      case '$maxKey':
        return { tipo: 'objectid', texto: 'MaxKey()' }
      case '$undefined':
        // Distinto de `null`: o Mongo antigo guardava os dois, e chamar um de
        // outro apagaria a diferença que o banco fez questão de manter.
        return { tipo: 'nulo', texto: 'undefined' }
      default:
        break
    }

    const filhos = campos(valor as Record<string, unknown>, fuso)
    return {
      tipo: 'objeto',
      texto: `{ ${filhos.length} ${filhos.length === 1 ? 'campo' : 'campos'} }`,
      filhos
    }
  }

  return { tipo: 'texto', texto: String(valor) }
}

/**
 * Os campos de um documento, na ordem em que o banco os devolveu.
 *
 * A ordem importa: no Mongo ela é a ordem de gravação do documento, e é a
 * mesma que o shell e o Compass mostram. Ordenar alfabeticamente aqui daria
 * uma tela mais bonita e um documento que não existe assim em lugar nenhum.
 */
export function campos(documento: Record<string, unknown>, fuso = 'UTC'): CampoDoDocumento[] {
  return Object.entries(documento).map(([chave, valor]) => ({
    chave,
    valor: interpretarValor(valor, fuso)
  }))
}

/**
 * Quantos campos (ou itens) um bloco mostra antes do "ver mais".
 *
 * Um documento de 84 campos ocupava a tela inteira e escondia o seguinte; a
 * pessoa rolava por um só sem conseguir comparar dois. Dez cabem numa olhada
 * e quase sempre incluem o que identifica o documento — o `_id` e os campos
 * gravados primeiro, que no Mongo costumam ser os principais.
 */
export const LIMITE_DE_CAMPOS = 10

/** O que um bloco mostra agora e quantos ficaram atrás do "ver mais". */
export function recortar<T>(itens: T[], inteiro: boolean, limite = LIMITE_DE_CAMPOS): { visiveis: T[]; ocultos: number } {
  // Esconder um só não compensa: o botão ocuparia a mesma linha que o campo.
  if (inteiro || itens.length <= limite + 1) return { visiveis: itens, ocultos: 0 }
  return { visiveis: itens.slice(0, limite), ocultos: itens.length - limite }
}

/** Separador de caminho: um caractere que nenhuma chave real do Mongo usa. */
export const SEPARADOR_DE_CAMINHO = '\u001f'

/**
 * Caminho de todo objeto ou lista não vazios do documento, em profundidade.
 * É o que "Expandir tudo" abre de uma vez.
 */
export function caminhosCompostos(lista: CampoDoDocumento[], prefixo = ''): string[] {
  const caminhos: string[] = []
  for (const { chave, valor } of lista) {
    if (!valor.filhos?.length) continue
    const caminho = prefixo ? `${prefixo}${SEPARADOR_DE_CAMINHO}${chave}` : chave
    caminhos.push(caminho, ...caminhosCompostos(valor.filhos, caminho))
  }
  return caminhos
}

/**
 * O documento como JSON legível, para copiar.
 *
 * Sai em EJSON mesmo — é o que se cola de volta no shell do Mongo ou aqui na
 * aba de query. Um JSON "limpo", com o ObjectId reduzido a texto, não voltaria
 * a ser o mesmo documento.
 */
export function comoJson(documento: Record<string, unknown>): string {
  return JSON.stringify(documento, null, 2)
}
