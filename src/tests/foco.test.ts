/**
 * Guarda de foco dos atalhos globais.
 *
 * O bug: a grade escutava `keydown` no `window` sem olhar onde estava o foco.
 * Com uma célula selecionada, Enter dentro do editor de SQL abria o editor da
 * célula e cancelava o evento — a quebra de linha na consulta não acontecia. E
 * ⌘C copiava a célula no lugar do SQL selecionado.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { digitandoEmCampo } from '../renderer/src/editor/foco.ts'

test('editor de código conta como digitação', () => {
  // O caso relatado: Enter no editor de SQL era engolido pela grade.
  assert.equal(digitandoEmCampo({ tagName: 'TEXTAREA', noEditorDeCodigo: true }), true)
  assert.equal(digitandoEmCampo({ tagName: 'DIV', noEditorDeCodigo: true }), true)
})

test('campos comuns também', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) {
    assert.equal(digitandoEmCampo({ tagName: tag }), true, tag)
  }
})

test('conteúdo editável conta', () => {
  assert.equal(digitandoEmCampo({ tagName: 'DIV', isContentEditable: true }), true)
})

test('o corpo e a própria grade não contam', () => {
  // Aqui os atalhos precisam continuar funcionando, senão o conserto quebra
  // a navegação por teclado que o recurso tem.
  assert.equal(digitandoEmCampo({ tagName: 'BODY' }), false)
  assert.equal(digitandoEmCampo({ tagName: 'DIV' }), false)
  assert.equal(digitandoEmCampo({ tagName: 'BUTTON' }), false)
  assert.equal(digitandoEmCampo({ tagName: 'TD' }), false)
})

test('sem foco em nada, os atalhos valem', () => {
  assert.equal(digitandoEmCampo(null), false)
  assert.equal(digitandoEmCampo(undefined), false)
})
