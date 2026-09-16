/**
 * Leitura do documento do Mongo na visão de documento.
 *
 * O que está em jogo aqui é o tipo. Um ObjectId e uma string de 24 caracteres
 * são a mesma coisa depois de um `JSON.stringify` ingênuo, e uma tela que
 * chama os dois de "texto" mente sobre o que está gravado no banco. Por isso o
 * documento chega em EJSON, e por isso estas regras existem.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { campos, interpretarValor } from '../renderer/src/editor/documento-mongo.ts'

test('ObjectId é reconhecido, e não vira texto', () => {
  const valor = interpretarValor({ $oid: '69c6e2ad9146e564fbad6a6c' })
  assert.equal(valor.tipo, 'objectid')
  assert.equal(valor.texto, "ObjectId('69c6e2ad9146e564fbad6a6c')")
})

test('texto que parece um ObjectId continua sendo texto', () => {
  // O outro lado da mesma moeda: sem o EJSON, os dois casos acima seriam
  // indistinguíveis, e a tela teria que adivinhar.
  const valor = interpretarValor('69c6e2ad9146e564fbad6a6c')
  assert.equal(valor.tipo, 'texto')
})

test('a data mostra o mesmo texto da grade, e guarda o instante completo', () => {
  const valor = interpretarValor({ $date: '2023-06-06T14:07:47.000Z' })
  assert.equal(valor.tipo, 'data')
  assert.equal(valor.texto, '2023-06-06 14:07:47')
  // Sem converter para o fuso local: a grade mostra UTC, e duas telas do mesmo
  // dado discordando em três horas é pior do que um texto mais longo.
  assert.equal(valor.detalhe, '2023-06-06T14:07:47.000Z')
})

test('data fora da faixa do ISO não vira [object Object]', () => {
  const valor = interpretarValor({ $date: { $numberLong: '-62135596800000' } })
  assert.equal(valor.tipo, 'data')
  assert.equal(valor.texto, '-62135596800000')
})

test('texto sai entre aspas, para o vazio e o espaço aparecerem', () => {
  assert.equal(interpretarValor('').texto, '""')
  assert.equal(interpretarValor('  ').texto, '"  "')
})

test('decimal fica como texto, com a precisão que o banco guardou', () => {
  const valor = interpretarValor({ $numberDecimal: '10.00000000000000000000001' })
  assert.equal(valor.tipo, 'numero')
  assert.equal(valor.texto, '10.00000000000000000000001')
})

test('objeto e lista viram resumo com os filhos prontos', () => {
  const objeto = interpretarValor({ rua: 'A', numero: 10 })
  assert.equal(objeto.tipo, 'objeto')
  assert.equal(objeto.texto, '{ 2 campos }')
  assert.deepEqual(
    objeto.filhos?.map((f) => f.chave),
    ['rua', 'numero']
  )

  const lista = interpretarValor([1, 2, 3])
  assert.equal(lista.texto, '[ 3 itens ]')
  assert.equal(lista.filhos?.length, 3)

  assert.equal(interpretarValor([1]).texto, '[ 1 item ]')
  assert.equal(interpretarValor({ a: 1 }).texto, '{ 1 campo }')
})

test('regex e binário são legíveis em vez de virarem objeto', () => {
  assert.equal(
    interpretarValor({ $regularExpression: { pattern: '^Mar', options: 'i' } }).texto,
    '/^Mar/i'
  )
  assert.equal(interpretarValor({ $binary: { base64: 'AQID', subType: '00' } }).tipo, 'binario')
})

test('undefined não é chamado de null', () => {
  // O Mongo antigo guardava os dois, e são coisas diferentes.
  assert.equal(interpretarValor({ $undefined: true }).texto, 'undefined')
  assert.equal(interpretarValor(null).texto, 'null')
})

test('objeto com mais de uma chave não é confundido com EJSON', () => {
  const valor = interpretarValor({ $oid: 'x', outro: 1 })
  assert.equal(valor.tipo, 'objeto')
})

test('campo com nome parecido com marcador do EJSON continua sendo campo', () => {
  // `{ $date: … }` dentro de um documento com outra chave junto não é uma data
  // do EJSON — é um documento cujo campo se chama `$date`.
  const lidos = campos({ $date: 'x', nome: 'Ana' })
  assert.deepEqual(
    lidos.map((c) => c.chave),
    ['$date', 'nome']
  )
})

test('a ordem dos campos é a do banco, não a do alfabeto', () => {
  const lidos = campos({ zeta: 1, alfa: 2, meio: 3 })
  assert.deepEqual(
    lidos.map((c) => c.chave),
    ['zeta', 'alfa', 'meio']
  )
})

test('campo ausente é ausente — não vira null', () => {
  // A razão de a visão de documento ler o documento, e não a matriz da grade:
  // lá, toda chave que qualquer documento do lote trouxe vira coluna, e quem
  // não tem aquela chave ganha um nulo que o banco nunca gravou.
  const lidos = campos({ nome: 'Bruno' })
  assert.deepEqual(
    lidos.map((c) => c.chave),
    ['nome']
  )
})
