/**
 * Quando um resultado de consulta pode ser editado.
 *
 * Editar uma célula vira `UPDATE tabela SET coluna = ? WHERE chave = ?`. Numa
 * aba de tabela as três incógnitas são conhecidas; num resultado de consulta,
 * nem sempre — e o modo de falhar é traiçoeiro. Um `JOIN` produz uma grade que
 * parece perfeitamente editável, mas a coluna `nome` pode vir de qualquer uma
 * das tabelas: gravar nela escreveria no lugar errado.
 *
 * Por isso os testes aqui cobrem tanto o que **deve** liberar quanto o que
 * **não pode** liberar. O segundo grupo é o que protege o dado.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { origemEditavel } from '../renderer/src/editor/origem-editavel.ts'

const BANCO = {
  tabelasDoBanco: ['accounts', 'activity_types', 'contracts'],
  colunasPorTabela: {
    accounts: ['id_account', 'created_at_account', 'vendor_account', 'account_owner'],
    activity_types: ['id', 'nome'],
    contracts: ['id', 'account_id', 'valor']
  }
}

const pedir = (sql: string, colunas: string[]): ReturnType<typeof origemEditavel> =>
  origemEditavel({ sql, colunasDoResultado: colunas, ...BANCO })

// ── o caso que motivou tudo ──────────────────────────────────────────

test('SELECT * de uma tabela só é editável', () => {
  const r = pedir('SELECT *\nFROM accounts\nLIMIT 100;', BANCO.colunasPorTabela.accounts)
  assert.equal(r.tabela, 'accounts')
  assert.equal(r.motivo, undefined)
})

test('lista explícita de colunas também', () => {
  const r = pedir('SELECT id_account, vendor_account FROM accounts', [
    'id_account',
    'vendor_account'
  ])
  assert.equal(r.tabela, 'accounts')
})

test('caixa e prefixo de schema não atrapalham', () => {
  assert.equal(pedir('SELECT * FROM ACCOUNTS', ['id_account']).tabela, 'accounts')
  assert.equal(pedir('SELECT * FROM public.accounts', ['ID_ACCOUNT']).tabela, 'accounts')
})

test('WHERE, ORDER BY e LIMIT não impedem', () => {
  const r = pedir(
    "SELECT * FROM accounts WHERE vendor_account = 'x' ORDER BY id_account DESC LIMIT 50",
    BANCO.colunasPorTabela.accounts
  )
  assert.equal(r.tabela, 'accounts')
})

// ── o que não pode liberar ───────────────────────────────────────────

test('JOIN é recusado — a coluna pode vir de qualquer lado', () => {
  const r = pedir('SELECT * FROM accounts a JOIN contracts c ON c.account_id = a.id_account', [
    'id_account'
  ])
  assert.equal(r.tabela, undefined)
  assert.match(r.motivo ?? '', /junta mais de uma tabela/)
})

test('GROUP BY é recusado — a linha da tela não é uma linha da tabela', () => {
  const r = pedir('SELECT account_owner, COUNT(*) FROM accounts GROUP BY account_owner', [
    'account_owner',
    'COUNT(*)'
  ])
  assert.equal(r.tabela, undefined)
  assert.match(r.motivo ?? '', /agrupado/)
})

test('DISTINCT e UNION também', () => {
  assert.ok(pedir('SELECT DISTINCT account_owner FROM accounts', ['account_owner']).motivo)
  assert.ok(
    pedir('SELECT * FROM accounts UNION SELECT * FROM contracts', ['id_account']).motivo
  )
})

test('coluna apelidada é recusada — o UPDATE citaria coluna inexistente', () => {
  const r = pedir('SELECT vendor_account AS dono FROM accounts', ['dono'])
  assert.equal(r.tabela, undefined)
  assert.match(r.motivo ?? '', /apelidada/)
  assert.match(r.motivo ?? '', /dono/, 'o motivo precisa dizer qual coluna')
})

test('coluna calculada é recusada', () => {
  const r = pedir('SELECT id_account, 1 + 1 AS dobro FROM accounts', ['id_account', 'dobro'])
  assert.match(r.motivo ?? '', /calculada|apelidada/)
})

test('tabela que o banco não tem é recusada', () => {
  const r = pedir('SELECT * FROM tabela_de_outro_banco', ['id'])
  assert.equal(r.tabela, undefined)
  assert.match(r.motivo ?? '', /não é uma tabela conhecida/)
})

test('consulta que não lê tabela nenhuma é recusada', () => {
  assert.match(pedir('SELECT 1', ['1']).motivo ?? '', /não lê de nenhuma tabela/)
})

test('consulta vazia é recusada', () => {
  assert.match(pedir('   ', []).motivo ?? '', /vazia/)
})

test('schema ainda não carregado é recusado, com motivo próprio', () => {
  // Diferente de "tabela desconhecida": aqui a tabela existe, só não sabemos
  // as colunas ainda. Dizer a mesma coisa nos dois casos confundiria.
  const r = origemEditavel({
    sql: 'SELECT * FROM accounts',
    colunasDoResultado: ['id_account'],
    tabelasDoBanco: ['accounts'],
    colunasPorTabela: {}
  })
  assert.match(r.motivo ?? '', /ainda não foram carregadas/)
})

// ── o motivo é sempre legível ────────────────────────────────────────

test('toda recusa vem com motivo escrito, nunca só um "não"', () => {
  const recusas = [
    'SELECT * FROM accounts a JOIN contracts c ON c.account_id = a.id_account',
    'SELECT account_owner, COUNT(*) FROM accounts GROUP BY account_owner',
    'SELECT vendor_account AS dono FROM accounts',
    'SELECT * FROM inexistente',
    'SELECT 1',
    ''
  ]
  for (const sql of recusas) {
    const r = pedir(sql, ['dono', 'account_owner', 'COUNT(*)', 'id_account', '1'])
    assert.equal(r.tabela, undefined, sql)
    assert.ok(r.motivo && r.motivo.length > 10, `motivo fraco para: ${sql}`)
  }
})
