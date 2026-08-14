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
export function escaparCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  const texto = String(valor)
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
