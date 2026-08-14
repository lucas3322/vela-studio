import { createWriteStream, existsSync, renameSync, unlinkSync, type WriteStream } from 'node:fs'
import { once } from 'node:events'
import type { DatabaseDriver } from './drivers/types'
import { BOM_UTF8, LINHAS_POR_ARQUIVO, linhaCsv, nomearParte } from './export-format.ts'

/**
 * Escreve o resultado de uma consulta em disco, em fluxo.
 *
 * ## O que estava errado antes
 *
 * A exportação recebia do renderer as linhas **que já estavam na grade** e as
 * reempacotava num arquivo. A grade é limitada de propósito, para a IDE não
 * travar. O resultado: numa tabela de 250.000 linhas, um `SELECT *` gravava
 * 100 linhas — 0,04% — e a IDE mostrava "Salvo em…" em verde. Nada falhava.
 * Alguém abriria o arquivo, somaria uma coluna e concluiria sobre a empresa
 * inteira a partir de um centésimo de por cento dos dados.
 *
 * ## Como funciona agora
 *
 * A consulta é refeita no processo principal e percorrida em blocos
 * (`driver.streamQuery`), e cada bloco vai direto para o disco. As linhas nunca
 * atravessam o IPC nem se acumulam na memória: o pico é um bloco, seja a
 * tabela de mil linhas ou de dez milhões.
 */

export interface ResultadoExportacao {
  /** Caminhos realmente gravados, na ordem. */
  arquivos: string[]
  linhas: number
}

export interface PedidoExportacao {
  driver: DatabaseDriver
  sql: string
  database?: string
  format: 'csv' | 'json'
  /** Caminho escolhido no diálogo de salvar. */
  caminho: string
  /** Chamado a cada bloco gravado, para a interface mostrar andamento. */
  aoProgredir?: (linhas: number, arquivos: number) => void
  /**
   * Linhas por arquivo. Só o teste passa outro valor: gerar 1.048.576 linhas
   * de verdade para exercitar a divisão levaria minutos, e o que precisa ser
   * verificado é a regra, não o tamanho.
   */
  linhasPorArquivo?: number
}

/**
 * Grava e devolve o que foi gravado.
 *
 * O número de arquivos só é conhecido no fim, e o nome de cada parte diz o
 * total (`vendas_2_de_5.csv`). Por isso a escrita vai para nomes temporários e
 * a renomeação acontece no fechamento — renomear é barato e instantâneo, e
 * evita deixar um `vendas.csv` truncado no lugar de um arquivo bom que já
 * existia ali, caso a exportação falhe no meio.
 */
export async function exportarEmFluxo({
  driver,
  sql,
  database,
  format,
  caminho,
  aoProgredir,
  linhasPorArquivo = LINHAS_POR_ARQUIVO
}: PedidoExportacao): Promise<ResultadoExportacao> {
  const temporarios: string[] = []
  let stream: WriteStream | null = null
  let linhasNoArquivo = 0
  let linhasNoTotal = 0
  let parte = 0
  let colunas: string[] = []

  const escrever = async (texto: string): Promise<void> => {
    // `write` devolve false quando o buffer encheu. Ignorar isso faz a memória
    // crescer sem limite justamente no caso que este código existe para
    // resolver: o arquivo gigante.
    if (!stream!.write(texto)) await once(stream!, 'drain')
  }

  const abrirParte = async (): Promise<void> => {
    parte += 1
    const temporario = `${caminho}.parte${parte}`
    temporarios.push(temporario)
    stream = createWriteStream(temporario, { encoding: 'utf-8' })
    linhasNoArquivo = 0

    if (format === 'csv') {
      await escrever(BOM_UTF8 + linhaCsv(colunas) + '\n')
    } else {
      await escrever('[\n')
    }
  }

  const fecharParte = async (): Promise<void> => {
    if (!stream) return
    if (format === 'json') await escrever('\n]\n')
    const atual = stream
    stream = null
    await new Promise<void>((resolve, reject) => {
      atual.end((erro?: Error | null) => (erro ? reject(erro) : resolve()))
    })
  }

  try {
    await driver.streamQuery(sql, { database }, async (bloco) => {
      if (bloco.rows.length === 0) return
      colunas = bloco.columns

      for (const linha of bloco.rows) {
        if (!stream || linhasNoArquivo >= linhasPorArquivo) {
          await fecharParte()
          await abrirParte()
        }

        if (format === 'csv') {
          await escrever(linhaCsv(linha) + '\n')
        } else {
          const objeto = Object.fromEntries(colunas.map((c, i) => [c, linha[i]]))
          await escrever((linhasNoArquivo === 0 ? '  ' : ',\n  ') + JSON.stringify(objeto))
        }

        linhasNoArquivo += 1
        linhasNoTotal += 1
      }

      aoProgredir?.(linhasNoTotal, parte)
    })

    // Consulta sem nenhuma linha ainda gera arquivo: um CSV só com cabeçalho
    // responde "a consulta não achou nada", enquanto arquivo nenhum parece
    // falha da exportação.
    if (!stream && parte === 0) await abrirParte()
    await fecharParte()

    const finais = temporarios.map((_, i) => nomearParte(caminho, i + 1, temporarios.length))
    temporarios.forEach((temporario, i) => renameSync(temporario, finais[i]))

    return { arquivos: finais, linhas: linhasNoTotal }
  } catch (erro) {
    // Sem esta limpeza, uma exportação interrompida deixaria arquivos
    // `.parte1` espalhados que ninguém sabe de onde vieram.
    await fecharParte().catch(() => {})
    for (const temporario of temporarios) {
      if (existsSync(temporario)) {
        try {
          unlinkSync(temporario)
        } catch {
          // Não conseguir apagar o rascunho não pode esconder o erro real.
        }
      }
    }
    throw erro
  }
}
