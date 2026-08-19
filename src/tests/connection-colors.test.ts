/**
 * Cor da conexão como acento da interface.
 *
 * A primeira versão disto tinha uma lista de sete cores próprias, separada das
 * paletas de acento. O defeito apareceu no primeiro uso: conexão marcada de
 * azul, interface violeta. Duas listas respondendo à mesma pergunta — "de que
 * cor é este banco?" — e nenhuma resposta.
 *
 * Agora é uma lista só, e o teste guarda essa unificação: se alguém recriar
 * uma lista paralela, ele reprova.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CORES_DE_CONEXAO,
  corDaConexao,
  paletaEmVigor,
  proximaCorLivre
} from '../renderer/src/styles/connection-colors.ts'
import { PALETAS, PALETA_PADRAO } from '../renderer/src/styles/palettes.ts'

// ── uma lista só ─────────────────────────────────────────────────────

test('a cor da conexão é a paleta da interface, não uma lista à parte', () => {
  // Se este teste falhar, voltamos ao bug: escolher azul na conexão e a IDE
  // ficar de outra cor.
  assert.deepEqual(
    CORES_DE_CONEXAO.map((c) => c.id),
    PALETAS.map((p) => p.id)
  )
})

test('o contraste vem de graça das paletas, já medidas', () => {
  // As paletas passam por `palettes.test.ts`, que exige 3:1 para interface e
  // 4.5:1 para texto nos dois temas. Reaproveitá-las evita repetir — e evita
  // que as duas listas divirjam com o tempo.
  for (const cor of CORES_DE_CONEXAO) {
    assert.ok(PALETAS.some((p) => p.id === cor.id), cor.id)
  }
})

// ── qual cor vale agora ──────────────────────────────────────────────

test('a conexão aberta manda na cor da IDE', () => {
  assert.equal(paletaEmVigor('azul', 'violeta'), 'azul')
})

test('sem cor na conexão, vale a preferência', () => {
  assert.equal(paletaEmVigor(undefined, 'violeta'), 'violeta')
  assert.equal(paletaEmVigor('', 'verde'), 'verde')
})

test('sem conexão e sem preferência válida, cai no padrão âmbar da logo', () => {
  // O estado neutro precisa ser a cor da marca: quem tem um banco só não
  // escolheu nada, e a IDE deve continuar parecendo ela mesma.
  assert.equal(paletaEmVigor(undefined, 'inexistente'), PALETA_PADRAO)
  assert.equal(PALETA_PADRAO, 'ambar')
})

test('cor de conexão desconhecida não sequestra a interface', () => {
  // Arquivo de conexões editado à mão, ou vindo de versão futura com uma cor
  // que esta ainda não tem.
  assert.equal(paletaEmVigor('turquesa-neon', 'verde'), 'verde')
})

// ── a marca sólida ───────────────────────────────────────────────────

test('resolve uma cor diferente para cada tema', () => {
  const escuro = corDaConexao('azul', 'dark')
  const claro = corDaConexao('azul', 'light')
  assert.match(escuro ?? '', /^#[0-9a-f]{6}$/i)
  assert.match(claro ?? '', /^#[0-9a-f]{6}$/i)
  // Os temas não são um o inverso do outro; se saírem iguais, a resolução por
  // tema deixou de acontecer.
  assert.notEqual(escuro, claro)
})

test('conexão sem cor não tem marca', () => {
  assert.equal(corDaConexao(undefined, 'dark'), undefined)
  assert.equal(corDaConexao('', 'light'), undefined)
})

test('id desconhecido não vira âmbar disfarçado', () => {
  // `acharPaleta` cai na primeira paleta quando não encontra. Deixar isso
  // vazar pintaria uma conexão de âmbar sem ninguém entender de onde veio.
  assert.equal(corDaConexao('turquesa-neon', 'dark'), undefined)
})

// ── sugestão automática ──────────────────────────────────────────────

test('a conexão nova nasce com uma cor ainda livre', () => {
  assert.equal(proximaCorLivre([]), PALETAS[0].id)
  assert.equal(proximaCorLivre([PALETAS[0].id]), PALETAS[1].id)
})

test('conexão sem cor não ocupa lugar na fila', () => {
  assert.equal(proximaCorLivre([undefined, PALETAS[0].id, undefined]), PALETAS[1].id)
})

test('esgotadas as cores, repete em vez de ficar sem nenhuma', () => {
  assert.equal(proximaCorLivre(PALETAS.map((p) => p.id)), PALETAS[0].id)
})
