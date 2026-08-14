/**
 * Formato e divisão dos arquivos de exportação.
 *
 * O bug que originou isto: a exportação mandava para o arquivo as linhas que
 * já estavam na grade. Numa tabela de 250.000 linhas, um `SELECT *` sem LIMIT
 * gravava **100** — 0,04% — e a IDE dizia "Salvo em…" em verde. Quem abrisse
 * o arquivo somaria uma coluna acreditando ter somado a tabela.
 *
 * Aqui ficam as regras que decidem se o arquivo gerado está certo. Todas
 * falham em silêncio quando erradas: o arquivo abre, só está errado.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOM_UTF8,
  LINHAS_POR_ARQUIVO,
  contarPartes,
  escaparCsv,
  linhaCsv,
  nomearParte
} from '../main/export-format.ts'

// ── divisão em arquivos ──────────────────────────────────────────────

test('o corte respeita o teto do Excel, contando o cabeçalho', () => {
  // O Excel para em 1.048.576 linhas incluindo o cabeçalho. Um arquivo com
  // 1.048.576 linhas de dados abre com a última faltando, sem aviso nenhum.
  assert.equal(LINHAS_POR_ARQUIVO + 1, 1_048_576)
})

test('conta quantos arquivos a exportação vai ocupar', () => {
  assert.equal(contarPartes(0), 1)
  assert.equal(contarPartes(1), 1)
  assert.equal(contarPartes(LINHAS_POR_ARQUIVO), 1)
  assert.equal(contarPartes(LINHAS_POR_ARQUIVO + 1), 2)
  assert.equal(contarPartes(LINHAS_POR_ARQUIVO * 3), 3)
  assert.equal(contarPartes(3_000_000), 3)
})

test('um arquivo só mantém exatamente o nome escolhido', () => {
  // Sufixo em exportação de arquivo único é ruído: ninguém quer vendas_1_de_1.
  assert.equal(nomearParte('/tmp/vendas.csv', 1, 1), '/tmp/vendas.csv')
})

test('várias partes são numeradas e dizem o total', () => {
  assert.equal(nomearParte('/tmp/vendas.csv', 1, 3), '/tmp/vendas_1_de_3.csv')
  assert.equal(nomearParte('/tmp/vendas.csv', 3, 3), '/tmp/vendas_3_de_3.csv')
})

test('a numeração ordena certo no Finder, que ordena por texto', () => {
  // Sem preencher com zero, "parte_10" aparece antes de "parte_2" e a pessoa
  // concatena os arquivos fora de ordem.
  const nomes = Array.from({ length: 12 }, (_, i) => nomearParte('/tmp/x.csv', i + 1, 12))
  assert.deepEqual([...nomes].sort(), nomes)
  assert.ok(nomes[0].includes('_01_de_12'))
  assert.ok(nomes[11].includes('_12_de_12'))
})

test('o nome preserva o diretório e a extensão', () => {
  const nome = nomearParte('/Users/alguem/Documentos/relatório final.csv', 2, 2)
  assert.equal(nome, '/Users/alguem/Documentos/relatório final_2_de_2.csv')
})

// ── escape de CSV ────────────────────────────────────────────────────

test('valor simples não ganha aspas à toa', () => {
  assert.equal(escaparCsv('Ana'), 'Ana')
  assert.equal(escaparCsv(42), '42')
  assert.equal(escaparCsv(0), '0')
  assert.equal(escaparCsv(false), 'false')
})

test('nulo vira campo vazio, não a palavra null', () => {
  // Gravar "null" faria a planilha mostrar o texto null como se fosse dado.
  assert.equal(escaparCsv(null), '')
  assert.equal(escaparCsv(undefined), '')
})

test('vírgula, aspa e quebra de linha são citadas', () => {
  assert.equal(escaparCsv('Recife, PE'), '"Recife, PE"')
  assert.equal(escaparCsv('diz "oi"'), '"diz ""oi"""')
  assert.equal(escaparCsv('linha 1\nlinha 2'), '"linha 1\nlinha 2"')
})

test('o retorno de carro sozinho também é citado', () => {
  // Dado vindo de sistema Windows carrega \r. O padrão CSV trata \r como
  // quebra de registro: sem citar, uma observação parte a linha em duas e
  // desloca todas as colunas seguintes — o arquivo abre, e está errado.
  assert.equal(escaparCsv('antes\rdepois'), '"antes\rdepois"')
  assert.equal(escaparCsv('windows\r\nquebra'), '"windows\r\nquebra"')
})

test('uma linha inteira é montada com o separador certo', () => {
  assert.equal(linhaCsv(['Ana', 30, null, 'Recife, PE']), 'Ana,30,,"Recife, PE"')
})

test('uma linha com veneno continua uma linha só', () => {
  // Verificação estrutural: fora das aspas não pode sobrar quebra de linha.
  const linha = linhaCsv(['a\nb', 'c,d', 'e"f', 'g\rh'])
  const semLiterais = linha.replace(/"(?:[^"]|"")*"/g, '')
  assert.ok(!/[\n\r]/.test(semLiterais), `quebra fora de literal: ${JSON.stringify(linha)}`)
})

// ── codificação ──────────────────────────────────────────────────────

test('o CSV começa com BOM para o Excel não estragar o acento', () => {
  // Sem BOM, o Excel no Windows assume a codificação da região: "José" abre
  // como "JosÃ©" e a conclusão é que a IDE corrompeu o dado.
  assert.equal(BOM_UTF8, '﻿')
  assert.equal(Buffer.from(BOM_UTF8, 'utf-8').toString('hex'), 'efbbbf')
})
