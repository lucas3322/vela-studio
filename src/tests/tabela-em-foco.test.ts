/**
 * Escolha da tabela que as receitas preenchem.
 *
 * O caso relatado: com a aba `accounts` aberta e uma query em foco, a receita
 * "Contar linhas" inseriu `SELECT COUNT(*) FROM account_blacklist_managers` —
 * a primeira do catálogo em ordem alfabética. A consulta roda, não dá erro
 * nenhum, e responde sobre outra tabela.
 *
 * É falha silenciosa da pior espécie: o resultado parece legítimo.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tabelaEmFoco, type AbaParaFoco } from '../renderer/src/editor/tabela-em-foco.ts'

const query = (sql: string): AbaParaFoco => ({ kind: 'query', sql })
const tabela = (table: string): AbaParaFoco => ({ kind: 'table', table, sql: '' })

const CATALOGO = ['account_blacklist_managers', 'accounts', 'contracts', 'invoices']

// ── o caso relatado ──────────────────────────────────────────────────

test('a query em foco decide, não a ordem alfabética do catálogo', () => {
  const escolhida = tabelaEmFoco({
    ativa: query('SELECT COUNT(*) AS total\nFROM accounts;'),
    abas: [tabela('accounts'), query('SELECT COUNT(*) FROM accounts;')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'accounts')
  assert.notEqual(escolhida, 'account_blacklist_managers')
})

test('query vazia em foco, mas há aba de tabela aberta', () => {
  // Foi exatamente esta a situação do print: Query #2 em foco, aba `accounts`
  // aberta ao lado, e a receita escolheu a primeira do catálogo.
  const escolhida = tabelaEmFoco({
    ativa: query(''),
    abas: [tabela('accounts'), query('')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'accounts')
})

// ── ordem dos sinais ─────────────────────────────────────────────────

test('aba de tabela ativa vence a aba aberta antes', () => {
  const escolhida = tabelaEmFoco({
    ativa: tabela('invoices'),
    abas: [tabela('accounts'), tabela('invoices')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'invoices')
})

test('entre várias abas de tabela, a mais recente', () => {
  const escolhida = tabelaEmFoco({
    ativa: query(''),
    abas: [tabela('accounts'), tabela('contracts'), query('')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'contracts')
})

test('o JOIN também conta como menção', () => {
  const escolhida = tabelaEmFoco({
    ativa: query('SELECT * FROM contracts c JOIN accounts a ON a.id = c.account_id'),
    abas: [],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'contracts', 'a primeira mencionada é a que manda')
})

// ── casamento com o catálogo ─────────────────────────────────────────

test('caixa diferente casa, e devolve o nome como o banco escreve', () => {
  const escolhida = tabelaEmFoco({
    ativa: query('SELECT * FROM ACCOUNTS'),
    abas: [],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'accounts', 'a receita precisa sair executável')
})

test('prefixo de schema não atrapalha', () => {
  const escolhida = tabelaEmFoco({
    ativa: query('SELECT * FROM public.invoices'),
    abas: [],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'invoices')
})

test('tabela mencionada que não existe no banco é ignorada', () => {
  // Nome digitado errado ou de outro banco: preencher a receita com ele
  // produziria uma consulta que falha sem explicar o porquê.
  const escolhida = tabelaEmFoco({
    ativa: query('SELECT * FROM tabela_que_nao_existe'),
    abas: [tabela('accounts')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, 'accounts', 'deve cair para o próximo sinal')
})

// ── sem sinal: marcador, não chute ───────────────────────────────────

test('sem nenhum sinal, não inventa tabela', () => {
  // Chutar a primeira do catálogo produzia uma consulta **executável e
  // errada**, que é a pior das saídas. `undefined` faz a receita sair com
  // `nome_da_tabela`, que ninguém confunde com dado real.
  const escolhida = tabelaEmFoco({
    ativa: query(''),
    abas: [query('')],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, undefined)
})

test('sem conexão nenhuma também não inventa', () => {
  assert.equal(tabelaEmFoco({ abas: [], tabelas: [] }), undefined)
})

test('aba de modelagem não é sinal de tabela', () => {
  const escolhida = tabelaEmFoco({
    ativa: { kind: 'model', sql: '' },
    abas: [{ kind: 'model', sql: '' }],
    tabelas: CATALOGO
  })
  assert.equal(escolhida, undefined)
})
