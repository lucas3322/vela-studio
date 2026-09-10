/**
 * Leitura de arquivo para dentro de uma tabela — o caminho inverso da
 * exportação.
 *
 * Duas famílias de função aqui:
 *
 * - **Pura**, sem `node:fs`: o parser de CSV em streaming, a detecção de
 *   delimitador e de cabeçalho, a dedução de tipo por amostragem, e a
 *   contagem de statements de um dump SQL. Tudo isso é testável com strings,
 *   sem tocar disco nem banco — é onde mora a lógica que decide o que a
 *   prévia mostra.
 * - **De arquivo**, que abre o caminho no disco e devolve `PreviaDeImportacao`
 *   ou percorre as linhas de um CSV em streaming, com progresso em bytes.
 *
 * O parser de CSV é próprio, não uma dependência: o formato tem poucas
 * regras, mas todas mordem se erradas — aspas escapadas por duplicação,
 * delimitador e quebra de linha dentro de campo citado, `\r\n` e `\n`
 * misturados no mesmo arquivo, e a última linha sem newline final.
 */
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ColunaDoArquivo, FormatoDeImportacao, PreviaDeImportacao, TipoDeduzido } from '../shared/types.ts'
import { splitStatements } from '../shared/sql-shape.ts'

/** Tamanho do bloco de leitura, em bytes — pequeno o bastante para a prévia não carregar o arquivo inteiro. */
const TAMANHO_BLOCO_LEITURA = 256 * 1024

/* ────────────────────────────────────────────────────────────────────
 * Parser de CSV em streaming — puro, sem `node:fs`.
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Interpreta CSV pedaço a pedaço, mantendo o estado entre chamadas de
 * `push`.
 *
 * As três armadilhas do formato, todas tratadas aqui:
 *  - aspas duplicadas (`""`) dentro de um campo citado são uma aspa literal,
 *    não o fim do campo;
 *  - delimitador e quebra de linha dentro de um campo citado não separam
 *    nada — só a aspa de fechamento (não duplicada) faz isso;
 *  - o caractere que fecha um campo citado pode ser o último de um pedaço,
 *    e só o próximo pedaço diz se era fechamento ou aspa escapada. Esse
 *    caso fica pendente (`aspaPendente`) até o próximo `push` ou `flush`.
 *
 * `\r\n` e `\n` viram o fim da mesma linha; um `\r` isolado no fim de um
 * pedaço também fica pendente até saber se o próximo caractere é `\n`.
 */
export class CsvLineParser {
  private readonly delimitador: string
  private campoAtual = ''
  private camposAtual: string[] = []
  private dentroDeAspas = false
  private crPendente = false
  private aspaPendente = false

  constructor(delimitador: string) {
    this.delimitador = delimitador
  }

  /** Alimenta um pedaço de texto e devolve as linhas completas encontradas nele. */
  push(pedaco: string): string[][] {
    const linhas: string[][] = []
    let i = 0

    if (this.aspaPendente) {
      this.aspaPendente = false
      if (pedaco[0] === '"') {
        this.campoAtual += '"'
        i = 1
      } else {
        this.dentroDeAspas = false
        // Não avança `i`: o caractere atual é reprocessado normalmente abaixo.
      }
    }

    while (i < pedaco.length) {
      const c = pedaco[i]

      if (this.crPendente) {
        this.crPendente = false
        if (c === '\n') {
          i++
          continue
        }
        // Senão, `c` é processado normalmente nesta mesma posição — não pula.
      }

      if (this.dentroDeAspas) {
        if (c === '"') {
          if (i === pedaco.length - 1) {
            // Último caractere do pedaço: só o próximo `push`/`flush` diz se
            // é fechamento ou aspa escapada.
            this.aspaPendente = true
            i++
            continue
          }
          if (pedaco[i + 1] === '"') {
            this.campoAtual += '"'
            i += 2
            continue
          }
          this.dentroDeAspas = false
          i++
          continue
        }
        this.campoAtual += c
        i++
        continue
      }

      if (c === '"' && this.campoAtual === '') {
        this.dentroDeAspas = true
        i++
        continue
      }
      if (c === this.delimitador) {
        this.camposAtual.push(this.campoAtual)
        this.campoAtual = ''
        i++
        continue
      }
      if (c === '\r') {
        this.camposAtual.push(this.campoAtual)
        this.campoAtual = ''
        linhas.push(this.camposAtual)
        this.camposAtual = []
        this.crPendente = true
        i++
        continue
      }
      if (c === '\n') {
        this.camposAtual.push(this.campoAtual)
        this.campoAtual = ''
        linhas.push(this.camposAtual)
        this.camposAtual = []
        i++
        continue
      }

      this.campoAtual += c
      i++
    }

    return linhas
  }

  /** Fecha o parser: devolve a última linha, se sobrou algo sem quebra final. */
  flush(): string[][] {
    // Aspa solta no fim do arquivo, sem par: trata como fechamento.
    this.aspaPendente = false
    if (this.campoAtual !== '' || this.camposAtual.length > 0) {
      this.camposAtual.push(this.campoAtual)
      const linha = this.camposAtual
      this.campoAtual = ''
      this.camposAtual = []
      return [linha]
    }
    return []
  }
}

/** Uma linha só com um campo vazio — sobra de linha em branco no arquivo, não dado. */
function ehLinhaEmBranco(campos: string[]): boolean {
  return campos.length === 1 && campos[0].trim() === ''
}

/** Marca de ordem de byte no início do texto decodificado. */
export function removerBom(texto: string): string {
  return texto.length > 0 && texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto
}

/* ────────────────────────────────────────────────────────────────────
 * Detecção de delimitador — pura.
 * ──────────────────────────────────────────────────────────────────── */

const DELIMITADORES_CANDIDATOS = [',', ';', '\t']

/**
 * Escolhe entre vírgula, ponto e vírgula e tabulação pela contagem
 * **consistente** de campos nas primeiras linhas — não pelo primeiro
 * candidato que aparece no texto. Um CSV de endereço em português costuma
 * ter vírgula dentro de um campo de texto ("Rua X, 123") e ponto e vírgula
 * como separador de verdade; contar ocorrências cruas erraria o delimitador
 * exatamente no arquivo que mais precisa da detecção.
 */
export function detectarDelimitador(amostra: string): string {
  const linhas = amostra
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 10)
  if (linhas.length === 0) return ','

  let melhorDelimitador = ','
  let melhorContagem = 0

  for (const delimitador of DELIMITADORES_CANDIDATOS) {
    const parser = new CsvLineParser(delimitador)
    const contagens: number[] = []
    for (const linha of linhas) {
      for (const campos of parser.push(`${linha}\n`)) contagens.push(campos.length)
    }
    if (contagens.length === 0) continue

    const primeira = contagens[0]
    const consistente = contagens.every((c) => c === primeira)
    if (primeira > 1 && consistente && primeira > melhorContagem) {
      melhorContagem = primeira
      melhorDelimitador = delimitador
    }
  }

  return melhorContagem > 0 ? melhorDelimitador : ','
}

/* ────────────────────────────────────────────────────────────────────
 * Dedução de tipo — pura.
 * ──────────────────────────────────────────────────────────────────── */

const RE_DATA_ISO = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
const RE_DATA_BR = /^\d{2}\/\d{2}\/\d{4}$/

/** Tipo de um único valor de texto — bloco de construção da dedução por coluna. */
export function tipoDeUmValor(bruto: string): TipoDeduzido {
  const v = bruto.trim()
  if (v === '') return 'vazio'
  if (/^(true|false|verdadeiro|falso)$/i.test(v)) return 'booleano'
  if (RE_DATA_ISO.test(v) || RE_DATA_BR.test(v)) return 'data'
  if (/^[+-]?\d+$/.test(v)) return 'inteiro'
  if (/^[+-]?(\d+[.,]\d+|\.\d+)$/.test(v)) return 'decimal'
  return 'texto'
}

/**
 * Tipo de uma coluna inteira, por amostragem: o valor mais frequente entre
 * os não vazios. Uma coluna só de valores vazios devolve `vazio` — dizer
 * "texto" seria inventar uma certeza que a amostra não deu.
 */
export function deduzirTipoColuna(valores: string[]): TipoDeduzido {
  const contagem: Record<TipoDeduzido, number> = {
    inteiro: 0,
    decimal: 0,
    booleano: 0,
    data: 0,
    texto: 0,
    vazio: 0
  }
  for (const v of valores) contagem[tipoDeUmValor(v)]++

  const tipos: TipoDeduzido[] = ['inteiro', 'decimal', 'booleano', 'data', 'texto']
  let melhor: TipoDeduzido = 'vazio'
  let melhorContagem = 0
  for (const t of tipos) {
    if (contagem[t] > melhorContagem) {
      melhorContagem = contagem[t]
      melhor = t
    }
  }
  return melhor
}

/**
 * A primeira linha parece cabeçalho?
 *
 * Heurística honesta, não uma certeza: se todo campo da primeira linha é
 * texto (ou vazio) e pelo menos uma coluna tem, nas linhas seguintes, um
 * tipo predominante diferente de texto — como `id` sendo o nome da coluna e
 * as linhas de baixo sendo números — a primeira linha é cabeçalho. Sem esse
 * segundo sinal, uma tabela cujo conteúdo real é só texto (nomes, por
 * exemplo) seria confundida com cabeçalho na primeira linha de dado.
 */
export function detectarCabecalho(linhas: string[][]): boolean {
  if (linhas.length < 2) return false
  const primeira = linhas[0]
  const demais = linhas.slice(1)

  const primeiraEhTexto = primeira.every((v) => {
    const t = tipoDeUmValor(v)
    return t === 'texto' || t === 'vazio'
  })
  if (!primeiraEhTexto) return false

  return primeira.some((_, j) => {
    const tipoDemais = deduzirTipoColuna(demais.map((l) => l[j] ?? ''))
    return tipoDemais !== 'texto' && tipoDemais !== 'vazio'
  })
}

/** Monta as colunas da prévia: nome (do cabeçalho ou `coluna N`), tipo deduzido e exemplos. */
export function construirColunas(linhas: string[][], temCabecalho: boolean): ColunaDoArquivo[] {
  if (linhas.length === 0) return []
  const numColunas = Math.max(...linhas.map((l) => l.length))
  const dados = temCabecalho ? linhas.slice(1) : linhas
  const cabecalho = temCabecalho ? linhas[0] : []

  const colunas: ColunaDoArquivo[] = []
  for (let j = 0; j < numColunas; j++) {
    const valores = dados.map((l) => l[j] ?? '')
    const nomeDoCabecalho = cabecalho[j]?.trim()
    const nome = temCabecalho && nomeDoCabecalho ? nomeDoCabecalho : `coluna ${j + 1}`
    const exemplos = valores.filter((v) => v.trim() !== '').slice(0, 5)
    colunas.push({ nome, indice: j, tipoDeduzido: deduzirTipoColuna(valores), exemplos })
  }
  return colunas
}

/* ────────────────────────────────────────────────────────────────────
 * Dump SQL — pura, reaproveitando `splitStatements`.
 * ──────────────────────────────────────────────────────────────────── */

/** Separa os comandos de um dump entre INSERT e "outros" — o que exige confirmação consciente. */
export function contarComandosSql(texto: string): { comandos: string[]; inserts: string[]; outros: string[] } {
  const comandos = splitStatements(texto)
  const inserts = comandos.filter((c) => /^\s*INSERT\b/i.test(c))
  const outros = comandos.filter((c) => !/^\s*INSERT\b/i.test(c))
  return { comandos, inserts, outros }
}

/**
 * Acha a linha (1-based) onde cada comando começa no texto original.
 *
 * `splitStatements` devolve os comandos já cortados e aparados, sem
 * posição — sem isso, a falha de um INSERT no meio de um dump de 50 mil
 * linhas não diz onde ele está. A busca é sempre a partir de onde o comando
 * anterior terminou: o mesmo texto pode se repetir no arquivo (dois INSERTs
 * idênticos, por exemplo), e buscar do zero acharia sempre o primeiro.
 */
export function numerosDeLinhaDosComandos(texto: string, comandos: string[]): number[] {
  const numeros: number[] = []
  let posicaoBusca = 0
  let linhaAcumulada = 1
  let posicaoAcumulada = 0

  for (const comando of comandos) {
    const indice = texto.indexOf(comando, posicaoBusca)
    const inicio = indice === -1 ? posicaoBusca : indice
    for (let i = posicaoAcumulada; i < inicio; i++) {
      if (texto[i] === '\n') linhaAcumulada++
    }
    numeros.push(linhaAcumulada)
    posicaoAcumulada = inicio
    posicaoBusca = inicio + comando.length
  }
  return numeros
}

/** Resumo de um comando para exibição: espaço colapsado e corte em 200 caracteres. */
function resumirComando(sql: string): string {
  const compacto = sql.replace(/\s+/g, ' ').trim()
  return compacto.length > 200 ? `${compacto.slice(0, 200)}…` : compacto
}

/* ────────────────────────────────────────────────────────────────────
 * Leitura de arquivo — usa `node:fs`.
 * ──────────────────────────────────────────────────────────────────── */

/** Abre um leitor de texto sobre um arquivo, decodificando UTF-8 com segurança entre blocos. */
function abrirLeitorDeTexto(caminho: string): {
  tamanhoBytes: number
  proximoTrecho(): { texto: string; posicao: number; fim: boolean }
  fechar(): void
} {
  const tamanhoBytes = statSync(caminho).size
  const fd = openSync(caminho, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(TAMANHO_BLOCO_LEITURA)
  let posicao = 0
  let primeiraVez = true

  return {
    tamanhoBytes,
    proximoTrecho() {
      const lidoAgora = readSync(fd, buffer, 0, TAMANHO_BLOCO_LEITURA, posicao)
      posicao += lidoAgora
      // `StringDecoder` retém bytes incompletos de um caractere multibyte até
      // o próximo `write` — sem isso, um "é" cortado ao meio na fronteira de
      // dois blocos de 256KB viraria lixo (mojibake) bem no meio do arquivo.
      let texto = lidoAgora > 0 ? decoder.write(buffer.subarray(0, lidoAgora)) : decoder.end()
      if (primeiraVez && texto) {
        texto = removerBom(texto)
        primeiraVez = false
      }
      return { texto, posicao, fim: lidoAgora === 0 }
    },
    fechar() {
      closeSync(fd)
    }
  }
}

function detectarFormatoPorExtensao(caminho: string): FormatoDeImportacao {
  return extname(caminho).toLowerCase() === '.sql' ? 'sql' : 'csv'
}

function lerPreviaCsv(
  caminho: string,
  tamanhoBytes: number,
  opcoes: { linhas: number; delimitador?: string }
): PreviaDeImportacao {
  const leitor = abrirLeitorDeTexto(caminho)
  try {
    let delimitador = opcoes.delimitador
    let parser: CsvLineParser | undefined
    let linhas: string[][] = []
    let truncadaPorLinhas = false

    for (;;) {
      const { texto, posicao, fim } = leitor.proximoTrecho()
      if (fim && !parser) break // arquivo vazio

      if (!parser) {
        if (!delimitador) delimitador = detectarDelimitador(texto)
        parser = new CsvLineParser(delimitador)
      }

      for (const campos of parser.push(texto)) {
        if (!ehLinhaEmBranco(campos)) linhas.push(campos)
      }

      if (linhas.length > opcoes.linhas) {
        truncadaPorLinhas = true
        break
      }
      if (fim || posicao >= tamanhoBytes) {
        for (const campos of parser.flush()) {
          if (!ehLinhaEmBranco(campos)) linhas.push(campos)
        }
        break
      }
    }

    const truncada = truncadaPorLinhas || linhas.length > opcoes.linhas
    if (linhas.length > opcoes.linhas) linhas = linhas.slice(0, opcoes.linhas)

    const temCabecalho = detectarCabecalho(linhas)
    const colunas = construirColunas(linhas, temCabecalho)

    return {
      formato: 'csv',
      caminho,
      tamanhoBytes,
      colunas,
      linhas,
      delimitador: delimitador ?? ',',
      temCabecalho,
      truncada
    }
  } finally {
    leitor.fechar()
  }
}

function lerPreviaSql(caminho: string, tamanhoBytes: number, linhasDesejadas: number): PreviaDeImportacao {
  // Um dump pode ter centenas de MB; a prévia lê só uma amostra do começo —
  // 2MB cobre milhares de INSERTs, o bastante para a pessoa conferir o que
  // vai rodar sem carregar o arquivo inteiro na memória.
  const TAMANHO_AMOSTRA = Math.min(tamanhoBytes, 2 * 1024 * 1024)
  const fd = openSync(caminho, 'r')
  let texto: string
  try {
    const buffer = Buffer.alloc(TAMANHO_AMOSTRA)
    const lido = readSync(fd, buffer, 0, TAMANHO_AMOSTRA, 0)
    texto = removerBom(buffer.subarray(0, lido).toString('utf-8'))
  } finally {
    closeSync(fd)
  }

  const truncadaPorTamanho = TAMANHO_AMOSTRA < tamanhoBytes
  const { comandos } = contarComandosSql(texto)
  // O último comando da amostra pode estar cortado no meio do arquivo — não
  // é um comando de verdade, é o resto de um SQL que continua fora da
  // amostra, e contá-lo mentiria sobre "comandos" e "inserts".
  const comandosCompletos = truncadaPorTamanho && comandos.length > 0 ? comandos.slice(0, -1) : comandos
  const insertsCompletos = comandosCompletos.filter((c) => /^\s*INSERT\b/i.test(c))
  const outrosCompletos = comandosCompletos.filter((c) => !/^\s*INSERT\b/i.test(c))

  return {
    formato: 'sql',
    caminho,
    tamanhoBytes,
    colunas: [],
    linhas: [],
    sql: {
      comandos: comandosCompletos.length,
      inserts: insertsCompletos.length,
      outros: outrosCompletos.slice(0, 20).map(resumirComando),
      primeiros: comandosCompletos.slice(0, linhasDesejadas).map(resumirComando)
    },
    truncada: truncadaPorTamanho
  }
}

/** Lê o começo de um arquivo (CSV ou SQL) e monta a prévia da importação. */
export function lerPreviaArquivo(
  caminho: string,
  opcoes: { linhas?: number; delimitador?: string } = {}
): PreviaDeImportacao {
  if (!existsSync(caminho)) throw new Error(`Arquivo não encontrado: ${caminho}`)
  const tamanhoBytes = statSync(caminho).size
  const linhasDesejadas = opcoes.linhas ?? 50

  if (detectarFormatoPorExtensao(caminho) === 'sql') {
    return lerPreviaSql(caminho, tamanhoBytes, linhasDesejadas)
  }
  return lerPreviaCsv(caminho, tamanhoBytes, { linhas: linhasDesejadas, delimitador: opcoes.delimitador })
}

/** Uma linha lida do arquivo, com o número físico (1-based) para o relato de falha apontar. */
export interface LinhaCsvLida {
  numero: number
  campos: string[]
}

/**
 * Percorre um CSV inteiro em streaming, linha a linha — o caminho da
 * importação de verdade, diferente de `lerPreviaArquivo` que só olha o
 * começo. `aoAvancarBytes` é chamado a cada bloco lido do disco: é o que dá
 * porcentagem honesta ao progresso, sem precisar contar linhas primeiro (o
 * que exigiria ler o arquivo duas vezes).
 */
export async function* lerLinhasCsv(
  caminho: string,
  opcoes: { delimitador: string },
  aoAvancarBytes?: (bytesLidos: number, bytesTotais: number) => void
): AsyncGenerator<LinhaCsvLida> {
  const leitor = abrirLeitorDeTexto(caminho)
  try {
    const parser = new CsvLineParser(opcoes.delimitador)
    let numero = 0

    for (;;) {
      const { texto, posicao, fim } = leitor.proximoTrecho()
      if (fim) break

      for (const campos of parser.push(texto)) {
        numero += 1
        if (!ehLinhaEmBranco(campos)) yield { numero, campos }
      }
      aoAvancarBytes?.(posicao, leitor.tamanhoBytes)
    }

    for (const campos of parser.flush()) {
      numero += 1
      if (!ehLinhaEmBranco(campos)) yield { numero, campos }
    }
    aoAvancarBytes?.(leitor.tamanhoBytes, leitor.tamanhoBytes)
  } finally {
    leitor.fechar()
  }
}
