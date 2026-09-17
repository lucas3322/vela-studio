/**
 * Rolar até o achado é ação, não resultado de render.
 *
 * O bug: com a busca (⌘F) aberta em cima de uma coluna, arrastar a borda de
 * **outra** coluna era impossível. A rolagem era disparada por um efeito, e a
 * largura das colunas é dependência dele: cada pixel de arrasto fazia o efeito
 * rodar e a grade voltar para a coluna achada, brigando com o mouse.
 *
 * A regra que estes testes travam: um pedido é atendido uma vez, e o que
 * identifica o pedido não tem nada de layout dentro.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deveNavegar,
  pedidoDaBusca,
  pedidoDaEvidencia
} from '../renderer/src/editor/navegacao-da-grade.ts'

test('o mesmo pedido não rola duas vezes', () => {
  // É este o caso do arrasto: o efeito roda de novo com o mesmo pedido,
  // muitas vezes por segundo.
  const pedido = pedidoDaBusca(3, 0)
  assert.equal(deveNavegar(null, pedido), true)
  assert.equal(deveNavegar(pedido, pedido), false)
})

test('apertar ↵ de novo no mesmo achado é pedido novo', () => {
  // Com um único achado, o índice não muda — e ainda assim a pessoa que
  // aperta ↵ depois de rolar para longe quer voltar até ele.
  const primeiro = pedidoDaBusca(3, 0)
  const segundo = pedidoDaBusca(4, 0)
  assert.notEqual(primeiro, segundo)
  assert.equal(deveNavegar(primeiro, segundo), true)
})

test('ir para outro achado da mesma busca é pedido novo', () => {
  assert.equal(deveNavegar(pedidoDaBusca(3, 0), pedidoDaBusca(4, 1)), true)
})

test('escolher outra coluna no filtro é pedido novo; a mesma, não', () => {
  const primeira = pedidoDaEvidencia('ACTIVATION_DATE')
  assert.equal(deveNavegar(null, primeira), true)
  assert.equal(deveNavegar(primeira, pedidoDaEvidencia('PRODUCT')), true)
  assert.equal(deveNavegar(primeira, pedidoDaEvidencia('ACTIVATION_DATE')), false)
})

test('busca e filtro não se confundem', () => {
  // Chaves de origens diferentes nunca podem colidir: um pedido do filtro
  // engolido por um da busca deixaria a coluna escolhida sem ser mostrada.
  assert.notEqual(pedidoDaBusca(1, 0), pedidoDaEvidencia('1'))
})

/*
 * A parte que o teste não alcança, e por isso fica escrita aqui: a chave do
 * pedido não pode ganhar nenhum ingrediente de layout — largura de coluna,
 * posição de rolagem, tamanho da viewport. No dia em que ganhar, cada pixel de
 * arrasto volta a ser um pedido novo e o bug renasce inteiro.
 */
