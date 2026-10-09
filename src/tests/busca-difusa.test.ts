/**
 * Busca difusa da paleta de comandos (⌘K).
 *
 * O que importa aqui é a ordem: com 200 tabelas, o item certo precisa estar
 * no topo depois de três letras, senão a paleta é só uma lista mais lenta.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuzzyMatch, splitByMatch } from '../renderer/src/editor/busca-difusa.ts'

const rank = (query: string, items: string[]): string[] =>
  items
    .map((text) => ({ text, m: fuzzyMatch(query, text) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.text)

test('consulta vazia casa com tudo', () => {
  assert.deepEqual(fuzzyMatch('', 'clientes'), { score: 0, indices: [] })
})

test('letras fora de ordem não casam', () => {
  assert.equal(fuzzyMatch('xyz', 'clientes'), null)
  assert.equal(fuzzyMatch('setneilc', 'clientes'), null)
})

test('caixa e acento não contam', () => {
  assert.ok(fuzzyMatch('historico', 'Histórico'))
  assert.ok(fuzzyMatch('SAO', 'São Paulo'))
  assert.ok(fuzzyMatch('preferências', 'Preferencias'))
})

test('índices apontam para o texto original', () => {
  assert.deepEqual(fuzzyMatch('hist', 'Histórico')!.indices, [0, 1, 2, 3])
  // Depois do "ó", que normaliza para "o" sem mudar o comprimento.
  assert.deepEqual(fuzzyMatch('ric', 'Histórico')!.indices, [5, 6, 7])
})

test('prefixo vence trecho no meio', () => {
  assert.deepEqual(rank('ped', ['itens_pedido', 'pedidos']), ['pedidos', 'itens_pedido'])
})

test('trecho contíguo prefere começo de palavra', () => {
  // "ped" aparece duas vezes; a do começo da palavra "pedido" é a que conta.
  assert.deepEqual(fuzzyMatch('ped', 'xped_pedido')!.indices, [5, 6, 7])
})

test('abreviação por iniciais acha o item', () => {
  // i·p de itens_pedido: começos de palavra.
  const m = fuzzyMatch('ip', 'itens_pedido')!
  assert.deepEqual(m.indices, [0, 6])
  assert.deepEqual(rank('ip', ['clientes_vip', 'itens_pedido']), ['itens_pedido', 'clientes_vip'])
})

test('espaço na consulta é ignorado', () => {
  assert.ok(fuzzyMatch('nova aba', 'Nova aba de query'))
  assert.ok(fuzzyMatch('novaaba', 'Nova aba de query'))
})

test('fronteira camelCase conta como começo de palavra', () => {
  assert.deepEqual(fuzzyMatch('ca', 'createdAt')!.indices, [0, 7])
})

test('salto para começo de palavra não inviabiliza o resto', () => {
  // O "p" de "pedido" é começo de palavra, mas depois dele não há "x".
  assert.ok(fuzzyMatch('px', 'apx_pedido'))
})

test('splitByMatch agrupa trechos vizinhos', () => {
  assert.deepEqual(splitByMatch('pedidos', [0, 1, 2]), [
    { text: 'ped', match: true },
    { text: 'idos', match: false }
  ])
  assert.deepEqual(splitByMatch('ab', []), [{ text: 'ab', match: false }])
})
