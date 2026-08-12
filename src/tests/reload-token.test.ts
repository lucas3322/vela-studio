/**
 * Token de recarga da aba.
 *
 * Parece trivial, mas a escolha entre contador e booleano é o que decide se
 * apertar ⌘R duas vezes recarrega duas vezes. O efeito da aba reage a mudança
 * de valor: um `true` que já era `true` não muda nada, e o segundo pedido
 * seria engolido em silêncio.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

interface Aba {
  id: string
  reloadToken?: number
}

/** Espelha `reloadTab` do store. */
function reloadTab(abas: Aba[], id: string): Aba[] {
  return abas.map((t) => (t.id === id ? { ...t, reloadToken: (t.reloadToken ?? 0) + 1 } : t))
}

test('o primeiro pedido sai de indefinido para 1', () => {
  const [aba] = reloadTab([{ id: 'a' }], 'a')
  assert.equal(aba.reloadToken, 1)
})

test('pedidos seguidos mudam o valor toda vez', () => {
  // A razão de ser um contador. Com booleano, o segundo ⌘R não recarregaria.
  let abas: Aba[] = [{ id: 'a' }]
  const vistos: Array<number | undefined> = []
  for (let i = 0; i < 3; i++) {
    abas = reloadTab(abas, 'a')
    vistos.push(abas[0].reloadToken)
  }
  assert.deepEqual(vistos, [1, 2, 3])
  assert.equal(new Set(vistos).size, 3, 'cada pedido precisa ser um valor novo')
})

test('recarregar uma aba não mexe nas outras', () => {
  const abas = reloadTab([{ id: 'a' }, { id: 'b', reloadToken: 7 }], 'a')
  assert.equal(abas[0].reloadToken, 1)
  assert.equal(abas[1].reloadToken, 7, 'a aba vizinha não pode reconsultar junto')
})

test('id inexistente não altera nada', () => {
  const original: Aba[] = [{ id: 'a', reloadToken: 2 }]
  assert.deepEqual(reloadTab(original, 'z'), original)
})
