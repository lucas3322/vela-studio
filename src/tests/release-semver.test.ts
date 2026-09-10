/**
 * Como um commit vira salto de versão.
 *
 * Este teste existe por causa de dois erros reais de versionamento, os dois
 * para o lado silencioso — o script escolheu `patch` numa release que a
 * mensagem do commit declarava incompatível:
 *
 * 1. `BREAKING CHANGE: add Redis support` (declaração no **assunto**, não no
 *    corpo) → saiu 0.28.1.
 * 2. `breaking(tests): add comprehensive tests…` (a palavra como **tipo**)
 *    → saiu 1.3.1, com o script imprimindo "breaking" ao lado do commit e
 *    "(patch)" duas linhas acima, contradizendo a si mesmo na tela.
 *
 * Os dois casos estão travados aqui embaixo pelo nome.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classificarCommit, decidirSalto, explicarSalto } from '../../scripts/release-semver.mjs'

const commit = (subject: string, body = ''): { subject: string; body: string; hash: string } => ({
  subject,
  body,
  hash: 'abc1234'
})

const salto = (...assuntos: string[]): string =>
  decidirSalto(assuntos.map((a) => classificarCommit(commit(a))), undefined)

// ── os dois acidentes ────────────────────────────────────────────────

test('`breaking(tests):` como tipo conta como incompatível', () => {
  const c = classificarCommit(commit('breaking(tests): add comprehensive tests'))
  assert.equal(c.type, 'breaking')
  assert.equal(c.breaking, true)
  assert.equal(salto('breaking(tests): add comprehensive tests'), 'major')
})

test('`BREAKING CHANGE:` no assunto conta, não só no corpo', () => {
  assert.equal(classificarCommit(commit('BREAKING CHANGE: add Redis support')).breaking, true)
  assert.equal(salto('BREAKING CHANGE: add Redis support'), 'major')
})

// ── as formas que o Conventional Commits define ──────────────────────

test('o `!` depois do tipo conta', () => {
  assert.equal(classificarCommit(commit('feat!: troca o formato do arquivo')).breaking, true)
  assert.equal(classificarCommit(commit('feat(export)!: troca o formato')).breaking, true)
})

test('`BREAKING CHANGE` no corpo conta', () => {
  const c = classificarCommit(commit('feat: novo driver', 'BREAKING CHANGE: o contrato mudou'))
  assert.equal(c.breaking, true)
})

// ── o resto da escada ────────────────────────────────────────────────

test('feat sem nada vira minor; fix e chore viram patch', () => {
  assert.equal(salto('feat: importar CSV'), 'minor')
  assert.equal(salto('fix: corrige a data no CSV'), 'patch')
  assert.equal(salto('chore: sobe dependência'), 'patch')
})

test('incompatível vence feat quando os dois aparecem', () => {
  assert.equal(salto('feat: importar CSV', 'breaking: muda o contrato'), 'major')
})

test('commit fora do padrão não inventa salto', () => {
  const c = classificarCommit(commit('arrumando umas coisas'))
  assert.equal(c.type, null)
  assert.equal(c.breaking, false)
  assert.equal(salto('arrumando umas coisas'), 'patch')
})

test('o salto informado no comando vence a análise', () => {
  const classificados = [classificarCommit(commit('fix: nada demais'))]
  assert.equal(decidirSalto(classificados, 'major'), 'major')
  assert.equal(explicarSalto(classificados, 'major'), 'salto informado no comando')
})

// ── a decisão precisa aparecer na tela ───────────────────────────────

test('o motivo aponta o commit que causou o salto', () => {
  const classificados = [
    classificarCommit(commit('fix: ajuste')),
    { ...classificarCommit(commit('breaking: muda contrato')), hash: 'dead123' }
  ]
  assert.match(explicarSalto(classificados, undefined), /incompatível/)
  assert.match(explicarSalto(classificados, undefined), /dead123/)
})
