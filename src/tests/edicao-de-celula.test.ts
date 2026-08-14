/**
 * Conversão entre o valor da célula e o texto que se edita.
 *
 * O bug: coluna JSON chega do driver como **objeto já interpretado**, e a
 * edição fazia `String(valor)` nele. O resultado era `"[object Object]"` na
 * caixa — e, ao confirmar, essa string literal ia para o banco no lugar do
 * JSON. Numa coluna `json` o banco recusa e ao menos aparece um erro; numa
 * coluna de texto guardando JSON, ele aceita e o dado se perde sem nada
 * falhar.
 *
 * A janela de edição só tornou o defeito visível: ela mostrava o
 * `[object Object]` e o acusava de JSON inválido. A edição na linha fazia o
 * mesmo há mais tempo, sem mostrar nada.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paraEdicao } from '../renderer/src/editor/cell-value.ts'

// ── o defeito relatado ───────────────────────────────────────────────

test('objeto vira JSON, nunca "[object Object]"', () => {
  const payload = { ItemCode: 'ATFX013628', CodigoEAN: null, GrupoItemId: 115 }
  const texto = paraEdicao(payload)

  assert.ok(!texto.includes('[object Object]'), texto)
  assert.deepEqual(JSON.parse(texto), payload, 'precisa voltar ao mesmo dado')
})

test('array também', () => {
  assert.equal(paraEdicao([1, 'dois', null]), '[1,"dois",null]')
})

test('o texto gerado é JSON válido — era isto que a janela acusava', () => {
  const payload = {
    ItemCode: 'ATFX013628',
    Descricao: 'RASTREADOR ST310U',
    NomeGrupo: 'Itens - OFICINA',
    FabricanteId: -1,
    NomeEstrangeiro: null
  }
  assert.doesNotThrow(() => JSON.parse(paraEdicao(payload)))
})

// ── compacto, não reindentado ────────────────────────────────────────

test('abre compacto, do jeito que está guardado', () => {
  // Reindentar na abertura marcaria a célula como alterada só por ter sido
  // aberta: a pessoa abre para olhar, fecha, e fica com uma alteração
  // pendente que ela não fez.
  const texto = paraEdicao({ a: 1, b: { c: 2 } })
  assert.equal(texto, '{"a":1,"b":{"c":2}}')
  assert.ok(!texto.includes('\n'), 'não pode vir quebrado em linhas')
})

// ── os outros tipos continuam como estavam ───────────────────────────

test('nulo e indefinido viram caixa vazia', () => {
  assert.equal(paraEdicao(null), '')
  assert.equal(paraEdicao(undefined), '')
})

test('texto, número e booleano passam direto', () => {
  assert.equal(paraEdicao('Ana'), 'Ana')
  assert.equal(paraEdicao(42), '42')
  assert.equal(paraEdicao(0), '0')
  assert.equal(paraEdicao(false), 'false')
  assert.equal(paraEdicao(-3.5), '-3.5')
})

test('texto que já é JSON não é mexido', () => {
  // Driver que devolve a coluna como string não pode ter o valor reserializado.
  const cru = '{"ja":"era texto"}'
  assert.equal(paraEdicao(cru), cru)
})

test('data vira o ISO, não um objeto', () => {
  // `Date` é objeto: sem tratamento cairia no `JSON.stringify` e viraria uma
  // string com aspas em volta, que não é o que a célula guarda.
  const d = new Date('2026-08-14T09:12:44.000Z')
  assert.equal(paraEdicao(d), '"2026-08-14T09:12:44.000Z"')
})

// ── ida e volta ──────────────────────────────────────────────────────

test('editar sem mexer em nada devolve o mesmo dado', () => {
  // É o caso do "abri, olhei, confirmei". O texto que sai da abertura, quando
  // reinterpretado, precisa ser idêntico ao que veio do banco.
  const original = { ItemCode: 'X', Precos: [{ lista: 'PADRAO', valor: 189.9 }], ativo: true }
  assert.deepEqual(JSON.parse(paraEdicao(original)), original)
})
