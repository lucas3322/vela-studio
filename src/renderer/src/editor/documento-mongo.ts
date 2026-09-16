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
 * A data como a grade também a mostra: `AAAA-MM-DD HH:MM:SS`, sem converter
 * para o fuso local.
 *
 * Converter seria pior do que parece: o documento guarda um instante em UTC, e
 * mostrar a hora local sem dizer que é local faz duas telas do mesmo dado
 * discordarem — a grade dizendo 14:07 e esta dizendo 11:07, sem nada
 * explicando a diferença.
 */
function dataLegivel(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso)
  return match ? `${match[1]} ${match[2]}` : iso
}

export function interpretarValor(valor: unknown): ValorDoDocumento {
  if (valor === null || valor === undefined) return { tipo: 'nulo', texto: 'null' }

  if (typeof valor === 'string') return { tipo: 'texto', texto: `"${valor}"`, detalhe: valor }
  if (typeof valor === 'number') return { tipo: 'numero', texto: String(valor) }
  if (typeof valor === 'boolean') return { tipo: 'booleano', texto: valor ? 'true' : 'false' }

  if (Array.isArray(valor)) {
    const filhos = valor.map((item, indice) => ({
      chave: String(indice),
      valor: interpretarValor(item)
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
        return { tipo: 'data', texto: dataLegivel(iso), detalhe: iso }
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

    const filhos = campos(valor as Record<string, unknown>)
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
export function campos(documento: Record<string, unknown>): CampoDoDocumento[] {
  return Object.entries(documento).map(([chave, valor]) => ({
    chave,
    valor: interpretarValor(valor)
  }))
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
