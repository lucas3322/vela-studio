/**
 * Quando fechar uma aba precisa avisar.
 *
 * A regra tem que casar com a bolinha que a aba já mostra: se a bolinha está
 * lá, fechar pergunta; se não está, fecha calado. Aviso e sinal visual
 * discordando seria pior do que não ter aviso — a pessoa aprenderia a não
 * confiar em nenhum dos dois.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { precisaAvisarAoFechar } from '../renderer/src/editor/fechar-aba.ts'

const aba = (patch: Partial<Parameters<typeof precisaAvisarAoFechar>[0]> = {}): Parameters<
  typeof precisaAvisarAoFechar
>[0] => ({ kind: 'query', dirty: true, sql: 'SELECT 1', ...patch })

test('query mexida e com conteúdo avisa', () => {
  assert.equal(precisaAvisarAoFechar(aba()), true)
})

test('query gerada e não tocada fecha sem perguntar', () => {
  // O "Gerar SELECT" do menu abre a aba com SQL que a pessoa não escreveu:
  // perguntar aqui viraria ruído em cada fechamento.
  assert.equal(precisaAvisarAoFechar(aba({ dirty: false })), false)
})

test('aba vazia (ou só espaço) fecha sem perguntar', () => {
  assert.equal(precisaAvisarAoFechar(aba({ sql: '' })), false)
  assert.equal(precisaAvisarAoFechar(aba({ sql: '   \n  \t ' })), false)
})

test('tabela e modelagem nunca avisam', () => {
  // Nada dentro delas foi digitado — é tudo releitura do banco, e reabrir
  // devolve o mesmo estado.
  assert.equal(precisaAvisarAoFechar(aba({ kind: 'table' })), false)
  assert.equal(precisaAvisarAoFechar(aba({ kind: 'model' })), false)
})
