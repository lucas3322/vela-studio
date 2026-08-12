/**
 * Cobertura da documentação de hover, dialeto por dialeto.
 *
 * A tese do produto é que a IDE **ensina** enquanto você usa. Uma palavra que
 * o autocomplete oferece mas o hover não explica quebra exatamente essa
 * promessa — e quebra em silêncio: nada falha, o balão só não aparece, e a
 * pessoa conclui que o recurso não existe. Foi assim com `JOIN` e `AS`.
 *
 * Este teste liga as duas listas: tudo que é sugerido precisa ser explicável.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { lookupDoc } from '../renderer/src/editor/sql-docs.ts'

/** Lê as palavras que o autocomplete oferece, direto da fonte. */
function palavrasOferecidas(): { porDialeto: Record<string, string[]>; funcoes: string[] } {
  const fonte = readFileSync('src/renderer/src/editor/completion.ts', 'utf-8')

  const blocoKeywords = fonte.slice(
    fonte.indexOf('KEYWORDS_BY_DIALECT'),
    fonte.indexOf('const FUNCTIONS')
  )
  const porDialeto: Record<string, string[]> = {}
  for (const grupo of blocoKeywords.matchAll(/(\w+):\s*\[([^\]]*)\]/gs)) {
    porDialeto[grupo[1]] = [...grupo[2].matchAll(/'([^']+)'|"([^"]+)"/g)].map(
      (m) => m[1] ?? m[2]
    )
  }

  const blocoFuncoes = fonte.slice(fonte.indexOf('const FUNCTIONS'), fonte.indexOf('/**', fonte.indexOf('const FUNCTIONS')))
  const funcoes = [...blocoFuncoes.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])

  return { porDialeto, funcoes }
}

const { porDialeto, funcoes } = palavrasOferecidas()

test('a leitura da fonte encontrou as listas', () => {
  // Sem esta âncora, um dia alguém renomeia a constante, a extração devolve
  // vazio e o teste passa cobrindo nada.
  assert.ok(porDialeto.common?.length > 20, 'lista comum não encontrada')
  assert.ok(funcoes.length > 10, 'lista de funções não encontrada')
  for (const dialeto of ['mysql', 'postgres', 'sqlite']) {
    assert.ok(porDialeto[dialeto]?.length, `lista do ${dialeto} não encontrada`)
  }
})

for (const dialeto of ['mysql', 'postgres', 'sqlite'] as const) {
  test(`${dialeto}: toda palavra sugerida tem explicação no hover`, () => {
    const palavras = [...porDialeto.common, ...(porDialeto[dialeto] ?? []), ...funcoes]
    const semDoc = palavras.filter((p) => !lookupDoc(p, dialeto))
    assert.deepEqual(semDoc, [], `sem documentação: ${semDoc.join(', ')}`)
  })
}

test('as palavras que o usuário reportou estão cobertas', () => {
  for (const dialeto of ['mysql', 'postgres', 'sqlite']) {
    for (const palavra of ['JOIN', 'AS']) {
      assert.ok(lookupDoc(palavra, dialeto), `${palavra} sem doc em ${dialeto}`)
    }
  }
})

test('o hover não depende da caixa em que foi digitado', () => {
  // Ninguém escreve tudo em maiúsculas o tempo todo.
  for (const palavra of ['join', 'Join', 'JOIN', 'as', 'As']) {
    assert.ok(lookupDoc(palavra, 'mysql'), palavra)
  }
})

test('toda entrada tem resumo, detalhe e categoria', () => {
  const palavras = [...porDialeto.common, ...porDialeto.mysql, ...funcoes]
  for (const palavra of palavras) {
    const doc = lookupDoc(palavra, 'mysql')
    if (!doc) continue
    assert.ok(doc.summary?.trim(), `${palavra}: resumo vazio`)
    assert.ok(doc.detail?.trim(), `${palavra}: detalhe vazio`)
    assert.ok(doc.category, `${palavra}: sem categoria`)
  }
})

test('MongoDB tem a própria documentação, sem cair na de SQL', () => {
  // `SELECT` não existe no Mongo: devolver a doc de SQL ali ensinaria errado.
  assert.equal(lookupDoc('SELECT', 'mongodb'), undefined)
  assert.ok(lookupDoc('find', 'mongodb'), 'find precisa ter doc')
})
