/**
 * O estado que a aba de tabela carrega entre uma visita e outra.
 *
 * Só a aba ativa fica montada: trocar de aba desmonta a `TableView` inteira.
 * Enquanto filtro, página, ordem e painel moraram em `useState`, voltar para a
 * aba significava reencontrá-la do zero — e o pior não era o filtro sumir da
 * barra, era a consulta ser refeita sem o `WHERE`, mostrando a tabela toda com
 * cara de resultado filtrado.
 *
 * Duas regras seguram isso, e as duas falham caladas quando quebram.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

interface EstadoDaAba {
  filtro?: Array<{ coluna: string; operador: string; valor: string }>
  rascunho?: Array<{ coluna: string; operador: string; valor: string }>
  pagina?: number
  ordem?: { column: string; direction: 'asc' | 'desc' } | null
  painel?: string
}

interface Aba {
  id: string
  view?: EstadoDaAba
}

/** Espelha `updateTabView` do store. */
function updateTabView(abas: Aba[], id: string, patch: EstadoDaAba): Aba[] {
  return abas.map((t) => (t.id === id ? { ...t, view: { ...t.view, ...patch } } : t))
}

const FILTRO = [{ coluna: 'PRODUCT', operador: 'igual', valor: 'MOT' }]

test('mudar de página não apaga o filtro', () => {
  // A razão de mesclar em vez de substituir: um patch raso trocaria o objeto
  // inteiro, e a próxima consulta sairia sem WHERE nenhum.
  let abas: Aba[] = [{ id: 'a' }]
  abas = updateTabView(abas, 'a', { filtro: FILTRO, rascunho: FILTRO, pagina: 0 })
  abas = updateTabView(abas, 'a', { pagina: 2 })

  assert.deepEqual(abas[0].view?.filtro, FILTRO)
  assert.equal(abas[0].view?.pagina, 2)
})

test('mexer em um campo preserva a identidade do array de filtro', () => {
  // O filtro está nas dependências do efeito que consulta o banco. Se cada
  // mudança de página devolvesse um array novo, a aba reconsultaria em laço —
  // a mesma armadilha que o seletor do Zustand tem no resto do app.
  let abas: Aba[] = [{ id: 'a' }]
  abas = updateTabView(abas, 'a', { filtro: FILTRO })
  const antes = abas[0].view?.filtro
  abas = updateTabView(abas, 'a', { pagina: 1, ordem: { column: 'id', direction: 'asc' } })

  assert.equal(abas[0].view?.filtro, antes, 'o array precisa ser o MESMO, não um igual')
})

test('cada aba guarda o seu, sem encostar na vizinha', () => {
  let abas: Aba[] = [{ id: 'a' }, { id: 'b' }]
  abas = updateTabView(abas, 'a', { filtro: FILTRO })

  assert.deepEqual(abas[1].view, undefined)
})

test('aba sem filtro guarda nada, não guarda uma condição em branco', () => {
  // A barra sempre desenha uma linha, mas a linha vazia não vira estado: se
  // virasse, o botão "Limpar" apareceria numa aba que nunca foi filtrada.
  const abas = updateTabView([{ id: 'a' }], 'a', { rascunho: [] })
  assert.deepEqual(abas[0].view?.rascunho, [])
})
