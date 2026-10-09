import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  categoriaDoTipo,
  chavesSemIndice,
  explicarAcaoReferencial,
  nomeDeIndice
} from '../renderer/src/editor/estrutura.ts'

test('categoria do tipo casa a palavra inteira, não um pedaço', () => {
  assert.equal(categoriaDoTipo('INTEGER'), 'numero')
  assert.equal(categoriaDoTipo('bigint unsigned'), 'numero')
  assert.equal(categoriaDoTipo('decimal(10,2)'), 'numero')
  assert.equal(categoriaDoTipo('varchar(255)'), 'texto')
  assert.equal(categoriaDoTipo('character varying'), 'texto')
  assert.equal(categoriaDoTipo('timestamp with time zone'), 'data')
  assert.equal(categoriaDoTipo('datetime(6)'), 'data')
  assert.equal(categoriaDoTipo('jsonb'), 'json')
  assert.equal(categoriaDoTipo('bytea'), 'binario')
  // `interval` tem `int` no meio, e não é número.
  assert.equal(categoriaDoTipo('interval'), 'data')
  assert.equal(categoriaDoTipo('geometry'), 'outro')
})

test('tinyint(1) é booleano no MySQL, tinyint largo é número', () => {
  assert.equal(categoriaDoTipo('tinyint(1)'), 'booleano')
  assert.equal(categoriaDoTipo('tinyint(4)'), 'numero')
  assert.equal(categoriaDoTipo('boolean'), 'booleano')
})

test('ação referencial vira o que vai acontecer, em português', () => {
  assert.equal(explicarAcaoReferencial('CASCADE', 'excluir'), 'apaga junto')
  assert.equal(explicarAcaoReferencial('cascade', 'atualizar'), 'atualiza junto')
  assert.equal(explicarAcaoReferencial('SET NULL', 'excluir'), 'vira NULL')
  assert.equal(explicarAcaoReferencial('NO ACTION', 'excluir'), 'impede a exclusão')
  // Sem ação declarada, o padrão do SQL é NO ACTION.
  assert.equal(explicarAcaoReferencial(undefined, 'atualizar'), 'impede a alteração')
})

test('FK só está coberta quando é a primeira coluna de algum índice', () => {
  const relacoes = [{ column: 'cliente_id' }, { column: 'produto_id' }, { column: 'loja_id' }]
  const indices = [{ columns: ['status', 'cliente_id'] }, { columns: ['produto_id'] }]
  assert.deepEqual(chavesSemIndice(relacoes, indices, ['id']), ['cliente_id', 'loja_id'])
})

test('a chave primária cobre a própria primeira coluna', () => {
  assert.deepEqual(chavesSemIndice([{ column: 'id' }], [], ['id']), [])
})

test('FK composta repetida aparece uma vez só', () => {
  assert.deepEqual(chavesSemIndice([{ column: 'a' }, { column: 'a' }], [], []), ['a'])
})

test('nome de índice limpa caracteres e respeita 63', () => {
  assert.equal(nomeDeIndice('pedidos', 'cliente_id'), 'idx_pedidos_cliente_id')
  assert.equal(nomeDeIndice('minha tabela', 'col-x'), 'idx_minha_tabela_col_x')
  assert.equal(nomeDeIndice('t'.repeat(80), 'c').length, 63)
})
