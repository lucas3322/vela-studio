/**
 * Persistência de queries salvas.
 *
 * O `ConnectionStore` importa `electron`, que não existe fora do app — então
 * exercitamos a mesma lógica sobre a estrutura de dados. O que precisa estar
 * travado aqui é a regra de criar-vs-atualizar: salvar de novo depois de cada
 * ajuste não pode empilhar cópias quase iguais na barra lateral.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SavedQuery } from '../shared/types.ts'

type Entrada = Omit<SavedQuery, 'createdAt' | 'updatedAt'>

/** Espelha `ConnectionStore.saveQuery`. */
function saveQuery(lista: SavedQuery[], entrada: Entrada, agora: number): SavedQuery[] {
  const anterior = lista.find((q) => q.id === entrada.id)
  const registro: SavedQuery = {
    ...entrada,
    createdAt: anterior?.createdAt ?? agora,
    updatedAt: agora
  }
  return anterior ? lista.map((q) => (q.id === entrada.id ? registro : q)) : [...lista, registro]
}

/** Espelha `ConnectionStore.listSavedQueries`. */
function listSavedQueries(lista: SavedQuery[], connectionId?: string): SavedQuery[] {
  const filtrada = connectionId ? lista.filter((q) => q.connectionId === connectionId) : lista
  return [...filtrada].sort((a, b) => b.updatedAt - a.updatedAt)
}

const base: Entrada = { id: 'q1', name: 'Contas ativas', sql: 'SELECT 1', connectionId: 'c1' }

test('salvar com id novo cria uma entrada', () => {
  const lista = saveQuery([], base, 1000)
  assert.equal(lista.length, 1)
  assert.equal(lista[0].createdAt, 1000)
  assert.equal(lista[0].updatedAt, 1000)
})

test('salvar com o mesmo id atualiza em vez de duplicar', () => {
  // A regra central: sem ela, três ⌘S viram três entradas quase iguais.
  let lista = saveQuery([], base, 1000)
  lista = saveQuery(lista, { ...base, sql: 'SELECT 2' }, 2000)
  lista = saveQuery(lista, { ...base, sql: 'SELECT 3' }, 3000)

  assert.equal(lista.length, 1, 'não pode acumular cópias')
  assert.equal(lista[0].sql, 'SELECT 3')
})

test('atualizar preserva a data de criação', () => {
  // A lista mostra "há 2 meses"; sobrescrever createdAt faria toda query
  // atualizada parecer recém-criada.
  let lista = saveQuery([], base, 1000)
  lista = saveQuery(lista, { ...base, name: 'Outro nome' }, 9000)

  assert.equal(lista[0].createdAt, 1000)
  assert.equal(lista[0].updatedAt, 9000)
})

test('"salvar como nova" gera entrada separada', () => {
  let lista = saveQuery([], base, 1000)
  lista = saveQuery(lista, { ...base, id: 'q2', name: 'Bifurcada' }, 2000)

  assert.equal(lista.length, 2)
  assert.deepEqual(lista.map((q) => q.name).sort(), ['Bifurcada', 'Contas ativas'])
})

test('a lista filtra por conexão', () => {
  let lista = saveQuery([], base, 1000)
  lista = saveQuery(lista, { ...base, id: 'q2', connectionId: 'c2' }, 2000)

  assert.equal(listSavedQueries(lista, 'c1').length, 1)
  assert.equal(listSavedQueries(lista, 'c2').length, 1)
  assert.equal(listSavedQueries(lista).length, 2, 'sem filtro, devolve todas')
})

test('a lista vem da mais recente para a mais antiga', () => {
  let lista = saveQuery([], { ...base, id: 'antiga' }, 1000)
  lista = saveQuery(lista, { ...base, id: 'nova' }, 5000)
  lista = saveQuery(lista, { ...base, id: 'media' }, 3000)

  assert.deepEqual(listSavedQueries(lista, 'c1').map((q) => q.id), ['nova', 'media', 'antiga'])
})
