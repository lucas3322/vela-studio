/**
 * Passos do tour e encaixe do cartão.
 *
 * Duas coisas falham em silêncio aqui e as duas arruínam o recurso:
 *
 * 1. Um passo cujo alvo não existe destaca o canto da tela e fala de um botão
 *    que a pessoa não acha.
 * 2. O cartão sai da janela. O destaque aparece, o texto não — e o tour, que
 *    existe para explicar, vira mais uma coisa a decifrar.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PASSOS,
  VERSAO_DO_TOUR,
  jaViuOTour,
  passosVisiveis,
  posicionarCartao
} from '../renderer/src/editor/tour.ts'

const CARTAO = { largura: 320, altura: 140 }
const JANELA = { largura: 1440, altura: 900 }

// ── os passos ────────────────────────────────────────────────────────

test('todo passo tem alvo, título e texto', () => {
  for (const passo of PASSOS) {
    assert.ok(passo.alvo, `${passo.id} sem alvo`)
    assert.ok(passo.titulo.length > 5, `${passo.id}: título fraco`)
    assert.ok(passo.texto.length > 30, `${passo.id}: texto não explica nada`)
  }
})

test('nenhum id nem alvo repetido', () => {
  assert.equal(new Set(PASSOS.map((p) => p.id)).size, PASSOS.length)
  assert.equal(new Set(PASSOS.map((p) => p.alvo)).size, PASSOS.length)
})

test('passo cujo alvo não existe é descartado', () => {
  // O botão de desconectar só existe com conexão ativa. Apontar para ele sem
  // conexão destacaria o nada.
  const visiveis = passosVisiveis(PASSOS, (alvo) => alvo !== 'desconectar')
  assert.equal(visiveis.length, PASSOS.length - 1)
  assert.ok(!visiveis.some((p) => p.alvo === 'desconectar'))
})

test('sem nenhum alvo na tela, não há tour', () => {
  assert.deepEqual(passosVisiveis(PASSOS, () => false), [])
})

// ── o cartão fica dentro da janela ───────────────────────────────────

test('alvo no meio: cartão embaixo e centralizado', () => {
  const p = posicionarCartao({ x: 700, y: 400, largura: 40, altura: 30 }, CARTAO, JANELA)
  assert.equal(p.acima, false)
  assert.equal(p.y, 400 + 30 + 12)
  assert.equal(p.x, 700 + 20 - 160)
})

test('alvo no canto direito não joga o cartão para fora', () => {
  // É exatamente onde ficam os botões da barra de título — o caso mais comum
  // do tour, e o que quebraria sem prender na borda.
  const p = posicionarCartao({ x: 1400, y: 10, largura: 28, altura: 28 }, CARTAO, JANELA)
  assert.ok(p.x + CARTAO.largura <= JANELA.largura, `saiu pela direita: ${p.x}`)
  assert.ok(p.x >= 0)
})

test('alvo no canto esquerdo também fica preso na borda', () => {
  const p = posicionarCartao({ x: 4, y: 500, largura: 28, altura: 28 }, CARTAO, JANELA)
  assert.ok(p.x >= 12, `entrou na margem: ${p.x}`)
})

test('alvo colado no rodapé joga o cartão para cima', () => {
  const p = posicionarCartao({ x: 700, y: 860, largura: 40, altura: 30 }, CARTAO, JANELA)
  assert.equal(p.acima, true)
  assert.ok(p.y + CARTAO.altura <= 860, 'o cartão não pode cobrir o próprio alvo')
})

test('o cartão nunca sai da janela, em nenhuma posição do alvo', () => {
  // Varredura: se existir um canto onde o cartão escapa, ele aparece aqui.
  for (let x = 0; x <= JANELA.largura; x += 60) {
    for (let y = 0; y <= JANELA.altura; y += 60) {
      const p = posicionarCartao({ x, y, largura: 30, altura: 28 }, CARTAO, JANELA)
      assert.ok(p.x >= 0 && p.x + CARTAO.largura <= JANELA.largura, `x fora em ${x},${y}: ${p.x}`)
      assert.ok(p.y >= 0, `y negativo em ${x},${y}: ${p.y}`)
    }
  }
})

test('janela estreita: o cartão pode não caber, mas não some pela esquerda', () => {
  const estreita = { largura: 300, altura: 600 }
  const p = posicionarCartao({ x: 280, y: 20, largura: 20, altura: 20 }, CARTAO, estreita)
  assert.ok(p.x >= 0, `escapou pela esquerda: ${p.x}`)
})

// ── a marca de "já viu" ──────────────────────────────────────────────

test('sem marca, o tour aparece', () => {
  assert.equal(jaViuOTour(null), false)
  assert.equal(jaViuOTour(''), false)
})

test('marca da versão atual esconde o tour', () => {
  assert.equal(jaViuOTour(String(VERSAO_DO_TOUR)), true)
})

test('marca de versão anterior deixa um tour novo aparecer', () => {
  // Guardar só `true` impediria mostrar um tour novo sem apagar a marca de
  // todo mundo — o que reexibiria o tour velho para quem acabou de vê-lo.
  assert.equal(jaViuOTour('0'), false)
  assert.equal(jaViuOTour(String(VERSAO_DO_TOUR + 1)), true, 'versão futura também conta como visto')
})

test('lixo guardado não esconde o tour', () => {
  // Um valor corrompido não pode calar o tour para sempre em silêncio.
  assert.equal(jaViuOTour('sim'), false)
  assert.equal(jaViuOTour('{}'), false)
})
