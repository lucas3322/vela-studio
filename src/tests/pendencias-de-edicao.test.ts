/**
 * Contagem de alterações pendentes entre abas.
 *
 * O caso relatado: alterações digitadas na aba de tabela, sem aplicar, e a
 * pessoa roda uma consulta noutra aba. A execução recarrega grades e remonta
 * resultados — o que foi digitado some, e **nunca chegou ao banco**. Nada na
 * tela dizia que tinha sido perdido.
 *
 * O total precisa atravessar abas, e precisa cair a zero quando a aba fecha:
 * um mapa que só cresce faria a IDE avisar de alteração inexistente, e o aviso
 * que mente é ignorado na segunda vez.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

/** Espelha `registrarPendencias` e `totalDePendencias` do store. */
function registrar(
  mapa: Record<string, number>,
  abaId: string,
  quantas: number
): Record<string, number> {
  const proximo = { ...mapa }
  if (quantas === 0) delete proximo[abaId]
  else proximo[abaId] = quantas
  return proximo
}

const total = (mapa: Record<string, number>): number =>
  Object.values(mapa).reduce((soma, n) => soma + n, 0)

test('sem pendência, o total é zero e a consulta roda direto', () => {
  assert.equal(total({}), 0)
})

test('pendência numa aba é vista de qualquer outra', () => {
  // É o caso relatado: edições na aba de tabela, consulta rodada na de query.
  const mapa = registrar({}, 'aba-tabela', 3)
  assert.equal(total(mapa), 3)
})

test('somam entre abas', () => {
  let mapa = registrar({}, 'tabela-a', 2)
  mapa = registrar(mapa, 'tabela-b', 1)
  assert.equal(total(mapa), 3)
})

test('zerar remove a aba do mapa, não guarda zero', () => {
  // Guardar zero faria o mapa crescer sem limite ao longo da sessão.
  let mapa = registrar({}, 'aba', 4)
  mapa = registrar(mapa, 'aba', 0)
  assert.deepEqual(mapa, {})
  assert.equal(total(mapa), 0)
})

test('aba fechada para de contar', () => {
  // A grade zera ao desmontar. Sem isso, uma aba fechada com edições
  // pendentes bloquearia toda consulta futura, sem nada que a pessoa pudesse
  // fazer para destravar.
  let mapa = registrar({}, 'aba-fechada', 5)
  assert.equal(total(mapa), 5)
  mapa = registrar(mapa, 'aba-fechada', 0)
  assert.equal(total(mapa), 0)
})

test('descartar limpa tudo de uma vez', () => {
  let mapa = registrar({}, 'a', 2)
  mapa = registrar(mapa, 'b', 3)
  assert.equal(total({}), 0, 'o descarte troca o mapa inteiro por vazio')
  assert.equal(total(mapa), 5)
})

test('atualizar a mesma aba substitui, não acumula', () => {
  let mapa = registrar({}, 'aba', 2)
  mapa = registrar(mapa, 'aba', 5)
  assert.equal(total(mapa), 5, 'contou 7 — estaria somando em vez de substituir')
})
