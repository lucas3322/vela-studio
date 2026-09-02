/**
 * Busca dentro da grade.
 *
 * O ponto delicado não é achar — é **dizer onde procurou**. A busca varre só
 * as linhas carregadas; numa tabela de 250 mil linhas com 100 na tela,
 * "0 resultados" seria lido como "esse valor não existe no banco". É o mesmo
 * erro que a exportação cometia, e ele custa uma conclusão errada.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  descreverBusca,
  procurarNaGrade,
  proximoAchado
} from '../renderer/src/editor/busca-na-grade.ts'

const COLUNAS = ['id_account', 'company_name_account', 'fantasy_name_account']
const LINHAS: unknown[][] = [
  [1, 'POLARTEC LTDA', 'POLARTECH'],
  [2, 'MCOMSAT RASTREAMENTO VEICULAR', 'MECOMSAT'],
  [3, 'VALTER UILLIAN DA SILVA', null]
]
const formatar = (v: unknown): string => (v === null || v === undefined ? 'NULL' : String(v))

const buscar = (termo: string): ReturnType<typeof procurarNaGrade> =>
  procurarNaGrade({ termo, colunas: COLUNAS, linhas: LINHAS, formatar })

// ── acha os dois tipos ───────────────────────────────────────────────

test('acha o valor dentro das células', () => {
  const r = buscar('POLARTEC')
  assert.ok(r.some((a) => a.tipo === 'celula' && a.linha === 0))
})

test('acha também o nome da coluna', () => {
  const r = buscar('fantasy')
  assert.equal(r.length, 1)
  assert.equal(r[0].tipo, 'coluna')
  assert.equal(r[0].coluna, 2)
})

test('coluna vem antes das células', () => {
  // Quem digita um nome de campo quer chegar na coluna, e ela costuma estar
  // fora da tela à direita. Enterrá-la depois das células faria o recurso
  // parecer não funcionar.
  const r = buscar('account')
  assert.equal(r[0].tipo, 'coluna')
})

test('a busca ignora a caixa', () => {
  assert.ok(buscar('polartec').length > 0)
  assert.ok(buscar('PoLaRtEc').length > 0)
})

test('acha por trecho, não só por igualdade', () => {
  assert.ok(buscar('OMSAT').some((a) => a.linha === 1))
})

test('enxerga o valor como a grade o mostra', () => {
  // A célula guarda `null`; a tela mostra "NULL". Procurar por "null" precisa
  // achar, senão a busca e os olhos discordam.
  assert.ok(buscar('null').some((a) => a.tipo === 'celula' && a.linha === 2))
})

// ── casos de borda ───────────────────────────────────────────────────

test('termo vazio não acha nada', () => {
  assert.deepEqual(buscar(''), [])
  assert.deepEqual(buscar('   '), [])
})

test('nada encontrado devolve lista vazia, não erro', () => {
  assert.deepEqual(buscar('zzzzzz'), [])
})

test('o teto de achados é respeitado', () => {
  // Uma página de 1000 linhas × 84 colunas geraria dezenas de milhares de
  // achados, e a lista viraria inútil antes de virar lenta.
  const muitas = Array.from({ length: 500 }, () => ['x', 'x', 'x'])
  const r = procurarNaGrade({
    termo: 'x',
    colunas: COLUNAS,
    linhas: muitas,
    formatar,
    maximo: 50
  })
  assert.equal(r.length, 50)
})

// ── navegação ────────────────────────────────────────────────────────

test('avança e dá a volta no fim', () => {
  assert.equal(proximoAchado(0, 3, 1), 1)
  assert.equal(proximoAchado(2, 3, 1), 0)
})

test('volta e dá a volta no começo', () => {
  assert.equal(proximoAchado(0, 3, -1), 2)
  assert.equal(proximoAchado(1, 3, -1), 0)
})

test('lista vazia não quebra a navegação', () => {
  assert.equal(proximoAchado(0, 0, 1), 0)
  assert.equal(proximoAchado(0, 0, -1), 0)
})

// ── a mensagem diz onde procurou ─────────────────────────────────────

test('sem achados, a mensagem diz que procurou só no carregado', () => {
  // Esta frase é a diferença entre "não existe" e "não está aqui".
  const msg = descreverBusca([], 0, 100)
  assert.match(msg, /100/)
  assert.match(msg, /carregadas/)
})

test('com achados, separa coluna de célula', () => {
  const msg = descreverBusca(buscar('account'), 0, 3)
  assert.match(msg, /1 de/)
  assert.match(msg, /coluna/)
})
