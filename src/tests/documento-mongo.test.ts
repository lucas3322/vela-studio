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
import { caminhosCompostos, campos, interpretarValor, isoNoFuso, previa, recortar } from '../renderer/src/editor/documento-mongo.ts'

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

test('a data aparece no fuso da conexão, e guarda o instante completo', () => {
  // As duas telas — grade e documento — usam o mesmo fuso, o da conexão. O
  // instante em UTC fica no detalhe, para quem precisa do valor exato.
  const valor = interpretarValor({ $date: '2023-06-06T14:07:47.000Z' }, 'America/Sao_Paulo')
  assert.equal(valor.tipo, 'data')
  assert.equal(valor.texto, '2023-06-06 11:07:47')
  assert.equal(valor.detalhe, '2023-06-06T14:07:47.000Z')

  // Conexão no fuso do servidor: UTC, igual à grade nesse caso.
  assert.equal(interpretarValor({ $date: '2023-06-06T14:07:47.000Z' }, 'UTC').texto, '2023-06-06 14:07:47')
})

test('data dentro de subdocumento usa o mesmo fuso da de fora', () => {
  const [campo] = campos({ plano: { renovaEm: { $date: '2025-08-01T02:00:00Z' } } }, 'America/Sao_Paulo')
  const [dentro] = campo.valor.filhos!
  // 02:00 UTC ainda é o dia anterior em São Paulo.
  assert.equal(dentro.valor.texto, '2025-07-31 23:00:00')
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

// ── Literal do shell e prévia (visão de documento em forma de JSON) ─────

const juntar = (v: ReturnType<typeof interpretarValor>): string =>
  (v.literal ?? []).map((p) => p.texto).join('')

test('cada tipo BSON sai como o mongosh o escreve', () => {
  assert.equal(juntar(interpretarValor({ $oid: '69c6e2ad9146e564fbad6a6c' })), 'ObjectId("69c6e2ad9146e564fbad6a6c")')
  assert.equal(juntar(interpretarValor({ $numberDecimal: '189.90' })), 'Decimal128("189.90")')
  assert.equal(juntar(interpretarValor('Ana "A" Souza')), '"Ana \\"A\\" Souza"')
  assert.equal(juntar(interpretarValor(42)), '42')
  assert.equal(juntar(interpretarValor(null)), 'null')
  assert.equal(interpretarValor({ a: 1 }).literal, undefined)
})

test('ISODate leva o deslocamento do fuso: nunca hora local fingindo ser UTC', () => {
  const iso = '2025-03-01T12:30:00.000Z'
  assert.equal(isoNoFuso(iso, 'America/Sao_Paulo'), '2025-03-01T09:30:00-03:00')
  assert.equal(isoNoFuso(iso, 'UTC'), '2025-03-01T12:30:00Z')
  assert.equal(juntar(interpretarValor({ $date: iso }, 'UTC')), 'ISODate("2025-03-01T12:30:00Z")')
})

test('prévia mostra o começo do objeto recolhido', () => {
  const cliente = interpretarValor({ nome: 'Ana', uf: 'SP', endereco: { cidade: 'Recife' } })
  assert.equal(previa(cliente), '{ "nome": "Ana", "uf": "SP", "endereco": {…} }')
  assert.equal(previa(interpretarValor(['web', 'promo'])), '[ "web", "promo" ]')
  assert.equal(previa(interpretarValor({})), '{}')
  assert.equal(previa(interpretarValor([])), '[]')
})

test('prévia longa corta no limite com reticências', () => {
  const longo = interpretarValor({ a: 'x'.repeat(30), b: 'y'.repeat(30), c: 'z'.repeat(30) })
  const texto = previa(longo, 72)
  assert.ok(texto.length <= 76, texto)
  assert.ok(texto.endsWith(', … }'), texto)
})

test('expandir tudo alcança objeto dentro de lista dentro de objeto', () => {
  const lista = campos({ a: 1, b: { c: [{ d: 1 }], e: {} } })
  const S = '\u001f'
  assert.deepEqual(caminhosCompostos(lista), ['b', `b${S}c`, `b${S}c${S}0`])
})

test('bloco longo mostra dez e conta o resto; inteiro mostra tudo', () => {
  const vinte = Array.from({ length: 20 }, (_, i) => i)
  assert.deepEqual(recortar(vinte, false), { visiveis: vinte.slice(0, 10), ocultos: 10 })
  assert.deepEqual(recortar(vinte, true), { visiveis: vinte, ocultos: 0 })
})

test('não esconde um campo só atrás de um botão', () => {
  const onze = Array.from({ length: 11 }, (_, i) => i)
  assert.equal(recortar(onze, false).ocultos, 0)
  assert.equal(recortar(onze.concat(11), false).ocultos, 2)
})
