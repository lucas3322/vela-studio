import { basename, dirname, extname, join } from 'node:path'

/**
 * Regras de formato e de divisão dos arquivos de exportação.
 *
 * Separado do código que escreve em disco para poder ser testado sem tocar no
 * sistema de arquivos nem em banco nenhum — é aqui que moram as decisões que,
 * se erradas, produzem um arquivo que abre mas está errado.
 */

/**
 * Linhas de dados por arquivo.
 *
 * O Excel para em 1.048.576 linhas **incluindo o cabeçalho**, e não avisa: ele
 * abre o arquivo, mostra o que coube e cala sobre o resto. O Google Sheets e o
 * LibreOffice têm tetos próprios, menores. Por isso a divisão acontece na
 * escrita: melhor três arquivos que abrem inteiros do que um que abre pela
 * metade sem dizer.
 */
export const LINHAS_POR_ARQUIVO = 1_048_575

/**
 * Nome de uma parte quando a exportação passa de um arquivo.
 *
 * Com uma parte só, o nome escolhido no diálogo é respeitado tal qual —
 * ninguém quer `vendas_1_de_1.csv`. A numeração é preenchida com zero à
 * esquerda para os arquivos ficarem em ordem no Finder, que ordena por texto:
 * sem isso, `parte_10` vem antes de `parte_2`.
 */
export function nomearParte(caminho: string, parte: number, totalDePartes: number): string {
  if (totalDePartes <= 1) return caminho

  const extensao = extname(caminho)
  const base = basename(caminho, extensao)
  const largura = String(totalDePartes).length
  const numero = String(parte).padStart(largura, '0')
  return join(dirname(caminho), `${base}_${numero}_de_${totalDePartes}${extensao}`)
}

/** Quantos arquivos uma quantidade de linhas vai ocupar. */
export function contarPartes(linhas: number): number {
  return Math.max(1, Math.ceil(linhas / LINHAS_POR_ARQUIVO))
}

/**
 * Um valor como campo CSV.
 *
 * Cita quando o texto contém separador, aspa ou quebra de linha — incluindo o
 * `\r` sozinho, que o padrão trata como quebra e que aparece em dado vindo de
 * sistema Windows. Sem citar o `\r`, uma observação com retorno de carro parte
 * o registro em dois e desloca todas as colunas seguintes.
 */
/**
 * Um valor do banco como texto, antes de virar campo CSV.
 *
 * `String(valor)` resolvia quase tudo e errava feio em dois casos — os dois
 * da mesma família de bug que este projeto já pagou:
 *
 * - **Data** saía como `Fri Mar 01 2024 00:00:00 GMT-0300 (Horário Padrão de
 *   Brasília)`. Ilegível no Excel e, pior, impossível de reimportar:
 *   exportação e importação são um par, e o arquivo que sai tem que poder
 *   voltar.
 * - **Coluna JSON** saía como `[object Object]` — exatamente o engano que a
 *   edição de célula já tinha cometido (ver `paraEdicao`), aqui de novo por
 *   outro caminho.
 *
 * A data é formatada pelos componentes **locais**, nunca por `toISOString()`:
 * ISO converte para UTC e, em fuso positivo, meia-noite local vira o dia
 * anterior — a data mudaria de dia dentro do arquivo, silenciosamente.
 */
export function valorParaTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return ''

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return ''
    const dd = (n: number): string => String(n).padStart(2, '0')
    const data = `${valor.getFullYear()}-${dd(valor.getMonth() + 1)}-${dd(valor.getDate())}`
    const temHora =
      valor.getHours() || valor.getMinutes() || valor.getSeconds() || valor.getMilliseconds()
    // Coluna DATE sai só com a data: acrescentar `00:00:00` que o banco não
    // tem faria o arquivo afirmar uma precisão que o dado não carrega.
    return temHora
      ? `${data} ${dd(valor.getHours())}:${dd(valor.getMinutes())}:${dd(valor.getSeconds())}`
      : data
  }

  // Buffer antes de objeto: `JSON.stringify` num Buffer devolveria
  // `{"type":"Buffer","data":[...]}`, que é pior do que o texto cru de antes.
  if (Buffer.isBuffer(valor)) return valor.toString()

  if (typeof valor === 'object') return JSON.stringify(valor)

  return String(valor)
}

export function escaparCsv(valor: unknown): string {
  const texto = valorParaTexto(valor)
  if (texto === '') return ''
  return /["\n\r,]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

export function linhaCsv(valores: unknown[]): string {
  return valores.map(escaparCsv).join(',')
}

/**
 * Marca de ordem de byte, escrita no início de todo CSV.
 *
 * O Excel no Windows assume a codificação da região quando o arquivo não tem
 * BOM: `José` vira `JosÃ©` e a pessoa conclui que a IDE corrompeu o dado. Três
 * bytes resolvem, e nenhum leitor sério de CSV se incomoda com eles.
 */
export const BOM_UTF8 = '﻿'
