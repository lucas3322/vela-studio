/**
 * O segundo argumento do `find` do Mongo.
 *
 * O bug que originou isto: `db.simcards.find({ ... }, { _id: 1 })` — a mesma
 * query que no Compass devolve só o `_id` — voltava aqui com o documento
 * inteiro. O driver do Node lê aquele lugar como `FindOptions`, não como
 * projeção, e opção desconhecida ele ignora sem reclamar. Query rodava, dado
 * voltava, só a seleção de colunas sumia no caminho.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { opcoesDeBusca, parseMongoCommand } from '../main/drivers/mongo-parser.ts'

test('a projeção do shell vira a opção projection do driver', () => {
  assert.deepEqual(opcoesDeBusca({ _id: 1 }), { projection: { _id: 1 } })
  assert.deepEqual(opcoesDeBusca({ nome: 1, email: 0 }), {
    projection: { nome: 1, email: 0 }
  })
})

test('objeto que já traz projection é opção do driver, e passa inteiro', () => {
  const opcoes = { projection: { _id: 1 }, limit: 5 }
  assert.deepEqual(opcoesDeBusca(opcoes), opcoes)
})

test('sem segundo argumento não inventa opção nenhuma', () => {
  assert.equal(opcoesDeBusca(undefined), undefined)
  assert.equal(opcoesDeBusca(null), undefined)
  // `find(filtro, {})` é o mesmo que não projetar nada: mandar
  // `projection: {}` faria o driver devolver só o `_id`.
  assert.equal(opcoesDeBusca({}), undefined)
})

test('o comando do usuário chega no driver com a projeção no lugar certo', () => {
  const plano = parseMongoCommand(
    'db.simcards.find({ "PRODUCT": "MOT" }, { "_id": 1 }).sort({ "ACTIVATION_DATE": 1 }).skip(0).limit(100)'
  )
  assert.deepEqual(plano.args[0], { PRODUCT: 'MOT' })
  assert.deepEqual(opcoesDeBusca(plano.args[1]), { projection: { _id: 1 } })
  assert.deepEqual(
    plano.chain.map((l) => l.name),
    ['sort', 'skip', 'limit']
  )
})
