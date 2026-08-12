/**
 * Regra do aviso de corte.
 *
 * O que precisa estar travado aqui não é a estética: é o fato de que
 * "faltam linhas" **nunca** deixa de ser dito. Se essa informação sumir, a
 * pessoa soma uma coluna achando que somou a tabela e a conta sai errada sem
 * nada na tela denunciando — o padrão de falha que este projeto persegue.
 *
 * O limite muda só o *volume* do aviso, nunca a existência dele.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

type Aviso = { visivel: false } | { visivel: true; tom: 'discreto' | 'alerta' }

/** Espelha a decisão do `TruncationNotice`. */
function decidir(cortadoEm: number | undefined, limiteAviso: number): Aviso {
  if (!cortadoEm) return { visivel: false }
  return { visivel: true, tom: cortadoEm >= limiteAviso ? 'alerta' : 'discreto' }
}

test('sem corte, nenhum aviso', () => {
  assert.deepEqual(decidir(undefined, 10_000), { visivel: false })
  assert.deepEqual(decidir(0, 10_000), { visivel: false })
})

test('corte abaixo do limite ainda avisa, em tom discreto', () => {
  // O caso que motivou a mudança: limite de preview em 1.000 fazia a barra
  // âmbar aparecer a cada execução. Ela some, o aviso não.
  const r = decidir(1_000, 10_000)
  assert.equal(r.visivel, true)
  assert.equal(r.visivel && r.tom, 'discreto')
})

test('corte no limite exato já entra como alerta', () => {
  const r = decidir(10_000, 10_000)
  assert.equal(r.visivel && r.tom, 'alerta')
})

test('corte acima do limite é alerta', () => {
  assert.equal(decidir(50_000, 10_000).visivel && decidir(50_000, 10_000).tom, 'alerta')
})

test('qualquer corte é visível, em qualquer limite', () => {
  // A garantia central: não existe combinação em que o corte fique invisível.
  for (const corte of [1, 10, 99, 100, 999, 1_000, 9_999, 10_000, 1_000_000]) {
    for (const limite of [1, 100, 10_000, 1_000_000]) {
      assert.equal(decidir(corte, limite).visivel, true, `corte ${corte}, limite ${limite}`)
    }
  }
})

test('limite muito baixo transforma tudo em alerta, sem esconder nada', () => {
  assert.equal(decidir(1, 1).visivel && decidir(1, 1).tom, 'alerta')
})
