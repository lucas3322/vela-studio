/**
 * Escrita da exportação em disco.
 *
 * Testado com um driver de mentira porque o que importa aqui é a regra, não o
 * banco: quantas linhas saem, em quantos arquivos, e o que sobra no disco
 * quando dá errado no meio. O teste contra banco real vive nos `*-e2e.mjs`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportarEmFluxo } from '../main/export-writer.ts'
import type { DatabaseDriver } from '../main/drivers/types.ts'

/** Driver que devolve `total` linhas em blocos, como um banco de verdade. */
function driverFalso(total: number, colunas = ['id', 'nome'], tamanhoBloco = 500): DatabaseDriver {
  return {
    async streamQuery(_sql, _opcoes, aoReceber) {
      for (let inicio = 0; inicio < total; inicio += tamanhoBloco) {
        const fim = Math.min(inicio + tamanhoBloco, total)
        const rows: unknown[][] = []
        for (let i = inicio; i < fim; i++) rows.push([i + 1, `nome ${i + 1}`])
        await aoReceber({ columns: colunas, rows })
      }
    }
  } as unknown as DatabaseDriver
}

function pasta(): string {
  return mkdtempSync(join(tmpdir(), 'vela-export-'))
}

const linhasDe = (caminho: string): string[] =>
  readFileSync(caminho, 'utf-8').replace(/^﻿/, '').trimEnd().split('\n')

// ── o bug que originou tudo ──────────────────────────────────────────

test('exporta a consulta inteira, não o pedaço que estava na grade', async () => {
  // O caso relatado: tabela grande, grade mostrando 100 linhas, arquivo saindo
  // com 100 e a IDE dizendo "salvo" em verde.
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(250_000),
    sql: 'SELECT * FROM grandona',
    format: 'csv',
    caminho: join(dir, 'saida.csv')
  })

  assert.equal(r.linhas, 250_000)
  assert.equal(r.arquivos.length, 1)
  assert.equal(linhasDe(r.arquivos[0]).length, 250_001, 'cabeçalho + 250.000 linhas')

  rmSync(dir, { recursive: true, force: true })
})

// ── divisão em arquivos ──────────────────────────────────────────────

test('passa do teto e divide em vários arquivos, cada um com cabeçalho', async () => {
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(2_500),
    sql: 'SELECT 1',
    format: 'csv',
    caminho: join(dir, 'vendas.csv'),
    linhasPorArquivo: 1_000
  })

  assert.equal(r.arquivos.length, 3)
  assert.equal(r.linhas, 2_500)

  // Cada parte precisa abrir sozinha numa planilha — sem cabeçalho, as partes
  // 2 e 3 mostrariam a primeira linha de dados como se fossem nomes de coluna.
  const contagens = r.arquivos.map((a) => linhasDe(a).length)
  assert.deepEqual(contagens, [1_001, 1_001, 501])
  for (const arquivo of r.arquivos) {
    assert.equal(linhasDe(arquivo)[0], 'id,nome')
  }

  // Nenhuma linha pode se perder nem se repetir na emenda entre arquivos.
  const ids = r.arquivos.flatMap((a) => linhasDe(a).slice(1).map((l) => Number(l.split(',')[0])))
  assert.equal(ids.length, 2_500)
  assert.equal(new Set(ids).size, 2_500)
  assert.equal(Math.min(...ids), 1)
  assert.equal(Math.max(...ids), 2_500)

  rmSync(dir, { recursive: true, force: true })
})

test('o nome só ganha sufixo quando há mais de um arquivo', async () => {
  const dir = pasta()
  const um = await exportarEmFluxo({
    driver: driverFalso(10),
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'unico.csv'),
    linhasPorArquivo: 1_000
  })
  assert.equal(um.arquivos[0], join(dir, 'unico.csv'))

  const varios = await exportarEmFluxo({
    driver: driverFalso(10),
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'partido.csv'),
    linhasPorArquivo: 4
  })
  assert.equal(varios.arquivos.length, 3)
  assert.ok(varios.arquivos[0].endsWith('partido_1_de_3.csv'))

  rmSync(dir, { recursive: true, force: true })
})

// ── formatos ─────────────────────────────────────────────────────────

test('o CSV sai com BOM, para o Excel não estragar o acento', async () => {
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(3, ['id', 'descrição']),
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'acentos.csv')
  })
  const bruto = readFileSync(r.arquivos[0])
  assert.equal(bruto.subarray(0, 3).toString('hex'), 'efbbbf')
  rmSync(dir, { recursive: true, force: true })
})

test('cada arquivo JSON é um array válido por si só', async () => {
  // Dividir um array JSON no meio produziria arquivos que nenhum leitor abre.
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(2_500),
    sql: 'q',
    format: 'json',
    caminho: join(dir, 'dados.json'),
    linhasPorArquivo: 1_000
  })

  assert.equal(r.arquivos.length, 3)
  let total = 0
  for (const arquivo of r.arquivos) {
    const lido = JSON.parse(readFileSync(arquivo, 'utf-8')) as Array<Record<string, unknown>>
    assert.ok(Array.isArray(lido))
    total += lido.length
  }
  assert.equal(total, 2_500)
  rmSync(dir, { recursive: true, force: true })
})

test('o JSON preserva nome de coluna e valor', async () => {
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(2),
    sql: 'q',
    format: 'json',
    caminho: join(dir, 'x.json')
  })
  const lido = JSON.parse(readFileSync(r.arquivos[0], 'utf-8')) as Array<Record<string, unknown>>
  assert.deepEqual(lido[0], { id: 1, nome: 'nome 1' })
  rmSync(dir, { recursive: true, force: true })
})

// ── casos de borda ───────────────────────────────────────────────────

test('consulta sem resultado gera arquivo, não silêncio', async () => {
  // Arquivo nenhum parece falha da exportação. Um CSV só com cabeçalho diz
  // claramente "a consulta rodou e não achou nada".
  const dir = pasta()
  const r = await exportarEmFluxo({
    driver: driverFalso(0),
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'vazio.csv')
  })
  assert.equal(r.linhas, 0)
  assert.equal(r.arquivos.length, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('exportação que falha no meio não deixa rascunho para trás', async () => {
  const dir = pasta()
  const quebrado = {
    async streamQuery(_s: string, _o: unknown, aoReceber: (b: unknown) => Promise<void>) {
      await aoReceber({ columns: ['id'], rows: [[1], [2], [3]] })
      throw new Error('conexão caiu no meio')
    }
  } as unknown as DatabaseDriver

  await assert.rejects(
    exportarEmFluxo({ driver: quebrado, sql: 'q', format: 'csv', caminho: join(dir, 'meio.csv') }),
    /conexão caiu/
  )

  // Nem o arquivo final nem o `.parte1` podem sobrar: um arquivo truncado com
  // nome de bom é pior do que nenhum arquivo.
  assert.deepEqual(readdirSync(dir), [], `sobrou: ${readdirSync(dir).join(', ')}`)
  rmSync(dir, { recursive: true, force: true })
})

test('o andamento é informado enquanto grava', async () => {
  const dir = pasta()
  const avisos: Array<{ linhas: number; arquivos: number }> = []
  await exportarEmFluxo({
    driver: driverFalso(2_000, ['id', 'nome'], 500),
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'p.csv'),
    aoProgredir: (linhas, arquivos) => avisos.push({ linhas, arquivos })
  })

  assert.ok(avisos.length >= 4, `poucos avisos: ${avisos.length}`)
  assert.equal(avisos.at(-1)?.linhas, 2_000)
  // Estritamente crescente: um contador que anda para trás mina a confiança
  // na barra inteira.
  for (let i = 1; i < avisos.length; i++) {
    assert.ok(avisos[i].linhas > avisos[i - 1].linhas, 'andamento andou para trás')
  }
  rmSync(dir, { recursive: true, force: true })
})

test('valor com vírgula e quebra de linha continua num campo só', async () => {
  const dir = pasta()
  const sujo = {
    async streamQuery(_s: string, _o: unknown, aoReceber: (b: unknown) => Promise<void>) {
      await aoReceber({
        columns: ['id', 'obs'],
        rows: [[1, 'Recife, PE\nsegunda linha'], [2, 'diz "oi"']]
      })
    }
  } as unknown as DatabaseDriver

  const r = await exportarEmFluxo({
    driver: sujo,
    sql: 'q',
    format: 'csv',
    caminho: join(dir, 'sujo.csv')
  })

  const texto = readFileSync(r.arquivos[0], 'utf-8').replace(/^﻿/, '')
  const semLiterais = texto.replace(/"(?:[^"]|"")*"/g, '')
  // Fora das aspas devem sobrar exatamente 3 quebras: cabeçalho e 2 registros.
  assert.equal((semLiterais.match(/\n/g) ?? []).length, 3, texto)
  rmSync(dir, { recursive: true, force: true })
})
