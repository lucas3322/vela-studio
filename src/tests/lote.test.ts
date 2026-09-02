/**
 * Execução de vários comandos em lote.
 *
 * O que motivou: mandando o lote inteiro numa chamada só, quando o terceiro de
 * dez quebra não dá para dizer **qual** quebrou nem o que já foi aplicado. A
 * pessoa fica com um erro genérico e um banco em estado desconhecido — a pior
 * combinação possível.
 *
 * Os testes aqui cobrem principalmente o relato: o que a tela afirma depois de
 * uma falha no meio precisa ser verdade, porque é com base nela que alguém
 * decide se roda de novo, se desfaz, ou se continua.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { QueryResult } from '../shared/types.ts'
import {
  classificarPasso,
  descreverLote,
  prepararLote,
  resumirComando,
  resumirLote,
  type PassoDoLote
} from '../renderer/src/editor/lote.ts'

const resultado = (rowCount: number): QueryResult =>
  ({ columns: [], rows: [], rowCount, durationMs: 1, statement: '' }) as QueryResult

// ── preparo ──────────────────────────────────────────────────────────

test('todo comando começa esperando', () => {
  const passos = prepararLote(['SELECT 1', 'SELECT 2'])
  assert.equal(passos.length, 2)
  assert.ok(passos.every((p) => p.estado === 'espera'))
})

// ── classificação ────────────────────────────────────────────────────

test('sucesso soma as linhas dos resultados', () => {
  const p = classificarPasso(
    { sql: 'q', estado: 'rodando' },
    { results: [resultado(3), resultado(4)] },
    120
  )
  assert.equal(p.estado, 'ok')
  assert.equal(p.linhas, 7)
  assert.equal(p.duracaoMs, 120)
})

test('erro presente é falha, mesmo vindo resultado junto', () => {
  // Alguns bancos devolvem as duas coisas. Tratar como sucesso porque "veio
  // resultado" esconderia a quebra — que é exatamente o que este recurso
  // existe para não deixar acontecer.
  const p = classificarPasso(
    { sql: 'q', estado: 'rodando' },
    { results: [resultado(2)], error: { friendly: 'coluna não existe' } as never },
    50
  )
  assert.equal(p.estado, 'erro')
  assert.ok(p.erro)
})

// ── resumo ───────────────────────────────────────────────────────────

const comErroNoTerceiro = (): PassoDoLote[] => [
  { sql: 'a', estado: 'ok', linhas: 1 },
  { sql: 'b', estado: 'ok', linhas: 2 },
  { sql: 'c', estado: 'erro', erro: { friendly: 'quebrou' } as never },
  { sql: 'd', estado: 'espera' },
  { sql: 'e', estado: 'espera' }
]

test('o resumo aponta qual comando quebrou', () => {
  const r = resumirLote(comErroNoTerceiro())
  assert.equal(r.total, 5)
  assert.equal(r.ok, 2)
  assert.equal(r.erros, 1)
  assert.equal(r.pendentes, 2)
  assert.equal(r.indiceDoErro, 2)
})

test('lote parado no erro NÃO conta como terminado', () => {
  // Ainda há a decisão de continuar. Marcar como terminado faria o modal
  // fechar sozinho e engolir a escolha.
  assert.equal(resumirLote(comErroNoTerceiro()).terminou, false)
})

test('lote inteiro executado conta como terminado', () => {
  const passos: PassoDoLote[] = [
    { sql: 'a', estado: 'ok' },
    { sql: 'b', estado: 'ok' }
  ]
  assert.equal(resumirLote(passos).terminou, true)
})

test('erro no último também termina', () => {
  const passos: PassoDoLote[] = [
    { sql: 'a', estado: 'ok' },
    { sql: 'b', estado: 'erro', erro: { friendly: 'x' } as never }
  ]
  assert.equal(resumirLote(passos).terminou, true)
})

// ── a frase precisa ser verdade ──────────────────────────────────────

test('depois de falhar no meio, diz o que já entrou no banco', () => {
  // É a pergunta que a pessoa realmente tem depois de um erro em lote.
  const frase = descreverLote(comErroNoTerceiro())
  assert.match(frase, /2 de 5 aplicados/)
  assert.match(frase, /2 não executados/)
  assert.match(frase, /comando 3/)
})

test('tudo certo diz tudo certo, sem número solto', () => {
  const frase = descreverLote([
    { sql: 'a', estado: 'ok' },
    { sql: 'b', estado: 'ok' }
  ])
  assert.match(frase, /2 comandos executados com sucesso/)
})

test('comando único não usa plural', () => {
  const frase = descreverLote([{ sql: 'a', estado: 'ok' }])
  assert.match(frase, /1 comando executado com sucesso/)
  assert.ok(!frase.includes('comandos'), frase)
})

// ── rótulo de cada comando na lista ──────────────────────────────────

test('o comando vira uma linha só na lista', () => {
  const sql = 'SELECT *\n  FROM clientes\n  WHERE cidade = \'Recife\''
  const rotulo = resumirComando(sql)
  assert.ok(!rotulo.includes('\n'))
  assert.match(rotulo, /SELECT \* FROM clientes/)
})

test('comando longo é cortado com reticências', () => {
  const rotulo = resumirComando('SELECT ' + 'x'.repeat(300), 40)
  assert.equal(rotulo.length, 40)
  assert.ok(rotulo.endsWith('…'))
})

test('comando curto passa inteiro', () => {
  assert.equal(resumirComando('SELECT 1'), 'SELECT 1')
})
