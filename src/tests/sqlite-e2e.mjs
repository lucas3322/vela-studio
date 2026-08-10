/**
 * Teste de ponta a ponta do SQLiteDriver contra um arquivo .db real.
 *
 * O `better-sqlite3` é compilado para o ABI do Electron, então este teste não
 * roda no `npm test` comum. Use `npm run test:sqlite`, que recompila para Node,
 * executa, e devolve o build para o Electron no final.
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SQLiteDriver } from './.sqlite-bundle.mjs'

const workdir = mkdtempSync(join(tmpdir(), 'vela-sqlite-'))
const filePath = join(workdir, 'loja.db')
const driver = new SQLiteDriver()

before(async () => {
  execFileSync('sqlite3', [filePath], {
    input: `
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT,
  cidade TEXT
);
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  valor REAL NOT NULL,
  status TEXT DEFAULT 'novo'
);
CREATE INDEX idx_pedidos_status ON pedidos(status);
CREATE VIEW vw_resumo AS SELECT cidade, COUNT(*) t FROM clientes GROUP BY cidade;
INSERT INTO clientes (nome, email, cidade) VALUES ('Ana','ana@x.com','Sao Paulo'),('Bruno',NULL,'Recife'),('Celia','c@x.com','Curitiba');
INSERT INTO pedidos (cliente_id, valor, status) VALUES (1,199.90,'pago'),(1,50.00,'novo'),(2,1200.55,'enviado');
`
  })
  await driver.connect({ id: 't', name: 't', driver: 'sqlite', filePath })
})

after(async () => {
  await driver.disconnect()
  rmSync(workdir, { recursive: true, force: true })
})

test('testConnection abre o arquivo e reporta a versão', async () => {
  const probe = new SQLiteDriver()
  const result = await probe.testConnection({ id: 't', name: 't', driver: 'sqlite', filePath })
  assert.equal(result.ok, true)
  assert.match(result.serverVersion, /^3\./)
})

test('testConnection reporta arquivo inexistente sem lançar', async () => {
  const probe = new SQLiteDriver()
  const result = await probe.testConnection({
    id: 't',
    name: 't',
    driver: 'sqlite',
    filePath: '/nao/existe.db'
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /não encontrado/)
})

test('listTables devolve tabelas e views com nome preenchido', async () => {
  const tables = await driver.listTables()
  assert.deepEqual(
    tables.map((t) => t.name).sort(),
    ['clientes', 'pedidos', 'vw_resumo']
  )
  assert.ok(tables.every((t) => typeof t.name === 'string' && t.name.length > 0))
  assert.equal(tables.find((t) => t.name === 'vw_resumo').type, 'view')
})

test('listColumns identifica chave primária e obrigatoriedade', async () => {
  const columns = await driver.listColumns('clientes')
  assert.deepEqual(columns.map((c) => c.name), ['id', 'nome', 'email', 'cidade'])
  assert.equal(columns.find((c) => c.name === 'id').isPrimaryKey, true)
  assert.equal(columns.find((c) => c.name === 'nome').nullable, false)
  assert.equal(columns.find((c) => c.name === 'email').nullable, true)
})

test('listColumns marca chave estrangeira', async () => {
  const columns = await driver.listColumns('pedidos')
  assert.equal(columns.find((c) => c.name === 'cliente_id').isForeignKey, true)
})

test('listIndexes encontra o índice declarado', async () => {
  const indexes = await driver.listIndexes('pedidos')
  const found = indexes.find((i) => i.name === 'idx_pedidos_status')
  assert.ok(found, JSON.stringify(indexes))
  assert.deepEqual(found.columns, ['status'])
})

test('listRelations resolve a chave estrangeira', async () => {
  const relations = await driver.listRelations('pedidos')
  assert.equal(relations.length, 1)
  assert.equal(relations[0].column, 'cliente_id')
  assert.equal(relations[0].referencedTable, 'clientes')
  assert.equal(relations[0].onDelete, 'CASCADE')
})

test('query executa JOIN com agregação', async () => {
  const [result] = await driver.query(
    `SELECT c.cidade, COUNT(*) AS total, ROUND(SUM(p.valor), 2) AS soma
     FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
     GROUP BY c.cidade ORDER BY total DESC`,
    { queryId: 'q1' }
  )
  assert.equal(result.rowCount, 2)
  assert.equal(result.columns.find((c) => c.name === 'total').type, 'number')
})

test('NULL atravessa como null', async () => {
  const [result] = await driver.query("SELECT email FROM clientes WHERE nome = 'Bruno'", {
    queryId: 'q2'
  })
  assert.equal(result.rows[0][0], null)
})

test('lote de statements devolve um resultado por statement', async () => {
  const results = await driver.query('SELECT 1 AS a; SELECT 2 AS b;', { queryId: 'q3' })
  assert.equal(results.length, 2)
})

test('maxRows corta o resultado e sinaliza', async () => {
  const [result] = await driver.query('SELECT * FROM pedidos', { queryId: 'q4', maxRows: 2 })
  assert.equal(result.rowCount, 2)
  assert.equal(result.truncatedAt, 2)
})

test('INSERT devolve linhas afetadas', async () => {
  const [result] = await driver.query("INSERT INTO clientes (nome) VALUES ('Novo')", {
    queryId: 'q5'
  })
  assert.equal(result.affectedRows, 1)
  assert.equal(result.columns.length, 0)
})

test('modo somente-leitura bloqueia escrita', async () => {
  const ro = new SQLiteDriver()
  await ro.connect({ id: 'r', name: 'r', driver: 'sqlite', filePath, readOnly: true })
  await assert.rejects(
    () => ro.query('DELETE FROM pedidos WHERE id = 1', { queryId: 'q6' }),
    /somente-leitura/
  )
  await ro.disconnect()
})
