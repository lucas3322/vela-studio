/**
 * Quem manda no número de linhas.
 *
 * São três fontes disputando, e a ordem entre elas já saiu errada uma vez: a
 * preferência do usuário foi passada como `maxRows` e passou a vencer o
 * `LIMIT` escrito na consulta — quem pedia `LIMIT 50000` recebia 100, sem
 * nada na tela explicando.
 *
 * A regra correta:
 *   1. `maxRows` — teto imposto pelo chamador (a exportação). Vence sempre.
 *   2. `LIMIT` na consulta — vence a preferência.
 *   3. `previewRows` — só quando não há LIMIT nenhum.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasExplicitLimit, DEFAULT_MAX_ROWS, PREVIEW_ROWS } from '../main/drivers/types.ts'

interface Opcoes {
  maxRows?: number
  previewRows?: number
}

/** Espelha a decisão dos quatro drivers. */
function tetoDeLinhas(sql: string, options: Opcoes = {}): number {
  const explicit = hasExplicitLimit(sql)
  return (
    options.maxRows ?? (explicit ? DEFAULT_MAX_ROWS : (options.previewRows ?? PREVIEW_ROWS))
  )
}

test('o LIMIT da consulta vence a preferência', () => {
  // O bug relatado: preferência em 100, consulta pedindo 50000.
  const teto = tetoDeLinhas('SELECT * FROM logs LIMIT 50000', { previewRows: 100 })
  assert.equal(teto, DEFAULT_MAX_ROWS)
  assert.ok(teto >= 50000, `${teto} não comporta o LIMIT 50000 pedido`)
})

test('sem LIMIT, a preferência decide', () => {
  assert.equal(tetoDeLinhas('SELECT * FROM logs', { previewRows: 250 }), 250)
})

test('sem LIMIT e sem preferência, cai no padrão', () => {
  assert.equal(tetoDeLinhas('SELECT * FROM logs'), PREVIEW_ROWS)
})

test('maxRows do chamador vence tudo', () => {
  // A exportação impõe o próprio teto e não pode ser cortada pela preferência
  // de visualização — foi o caso que quase quebrei ao juntar os dois campos.
  assert.equal(tetoDeLinhas('SELECT * FROM logs', { maxRows: 100_000, previewRows: 100 }), 100_000)
  assert.equal(
    tetoDeLinhas('SELECT * FROM logs LIMIT 10', { maxRows: 100_000, previewRows: 100 }),
    100_000
  )
})

test('a preferência nunca reduz um LIMIT explícito, em nenhum valor', () => {
  for (const preferencia of [1, 10, 100, 1000]) {
    const teto = tetoDeLinhas('SELECT * FROM t LIMIT 5000', { previewRows: preferencia })
    assert.ok(teto >= 5000, `preferência ${preferencia} cortou o LIMIT: teto ${teto}`)
  }
})

// ── quando o aviso de consulta pesada aparece ────────────────────────

interface Aviso {
  tom: 'nenhum' | 'discreto' | 'alerta'
}

/** Espelha a decisão do `TruncationNotice`. */
function avisar(linhas: number, cortadoEm: number | undefined, limiteAviso: number): Aviso {
  if (linhas >= limiteAviso || (!!cortadoEm && cortadoEm >= limiteAviso)) return { tom: 'alerta' }
  if (cortadoEm) return { tom: 'discreto' }
  return { tom: 'nenhum' }
}

test('resultado grande avisa mesmo sem ter sido cortado', () => {
  // O segundo bug relatado: `LIMIT 50000` obedecido devolve 50 mil linhas,
  // nada é truncado, e o aviso nunca aparecia — justamente no caso em que ele
  // mais serve.
  assert.equal(avisar(50_000, undefined, 10_000).tom, 'alerta')
})

test('resultado pequeno e completo não avisa nada', () => {
  assert.equal(avisar(12, undefined, 10_000).tom, 'nenhum')
})

test('corte pequeno continua sendo informado, em voz baixa', () => {
  assert.equal(avisar(100, 100, 10_000).tom, 'discreto')
})

test('corte grande é alerta', () => {
  assert.equal(avisar(10_000, 10_000, 10_000).tom, 'alerta')
})
