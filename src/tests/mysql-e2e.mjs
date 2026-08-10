/**
 * Teste de ponta a ponta do MySQLDriver contra um MySQL 8 real.
 *
 * Existe por causa de um bug que nenhum teste de tipo pegaria: no MySQL 8 as
 * views do `information_schema` devolvem os nomes de coluna em MAIÚSCULAS
 * (`TABLE_NAME`), e no 5.7 em minúsculas. Ler `row.table_name` não dá erro —
 * devolve `undefined`, e a barra lateral lista 209 tabelas sem nome.
 *
 * Subir o banco:
 *   docker run -d --name vela-mysql-test -e MYSQL_ROOT_PASSWORD=vela123 \
 *     -e MYSQL_DATABASE=lojinha -p 33061:3306 mysql:8.0
 *
 * Rodar:
 *   node --experimental-strip-types --test src/tests/mysql-e2e.mjs
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { MySQLDriver } from './.mysql-bundle.mjs'

const config = {
  id: 'test',
  name: 'test',
  driver: 'mysql',
  host: '127.0.0.1',
  port: 33061,
  user: 'root',
  password: 'vela123',
  database: 'lojinha'
}

const driver = new MySQLDriver()

before(async () => {
  await driver.connect(config)
  // O teste semeia o próprio schema: depender de seed externo já fez a suíte
  // falhar inteira só porque o container tinha sido recriado.
  await driver.query(
    `DROP VIEW IF EXISTS vw_resumo;
     DROP TABLE IF EXISTS pedidos;
     DROP TABLE IF EXISTS clientes;
     CREATE TABLE clientes (
       id INT AUTO_INCREMENT PRIMARY KEY,
       nome VARCHAR(120) NOT NULL COMMENT 'nome completo',
       email VARCHAR(180),
       cidade VARCHAR(80),
       criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     ) COMMENT='cadastro de clientes';
     CREATE TABLE pedidos (
       id INT AUTO_INCREMENT PRIMARY KEY,
       cliente_id INT NOT NULL,
       valor DECIMAL(10,2) NOT NULL,
       status VARCHAR(20) DEFAULT 'novo',
       KEY idx_status (status),
       CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
     );
     CREATE VIEW vw_resumo AS SELECT cidade, COUNT(*) t FROM clientes GROUP BY cidade;
     INSERT INTO clientes (nome, email, cidade) VALUES
       ('Ana','ana@x.com','Sao Paulo'),('Bruno',NULL,'Recife'),('Celia','c@x.com','Curitiba');
     INSERT INTO pedidos (cliente_id, valor, status) VALUES
       (1,199.90,'pago'),(1,50.00,'novo'),(2,1200.55,'enviado');`,
    { queryId: 'seed' }
  )
})

after(async () => {
  await driver.disconnect()
})

test('testConnection reporta versão do servidor', async () => {
  const probe = new MySQLDriver()
  const result = await probe.testConnection(config)
  assert.equal(result.ok, true)
  assert.match(result.serverVersion, /^8\./)
  await probe.disconnect()
})

test('testConnection reporta senha errada sem travar', async () => {
  const probe = new MySQLDriver()
  const result = await probe.testConnection({ ...config, password: 'errada' })
  assert.equal(result.ok, false)
  assert.match(result.message, /Access denied/i)
  await probe.disconnect()
})

test('listDatabases devolve nomes, não undefined', async () => {
  const databases = await driver.listDatabases()
  assert.ok(databases.includes('lojinha'), JSON.stringify(databases))
  assert.ok(databases.every((d) => typeof d === 'string' && d.length > 0))
})

test('listTables devolve nomes preenchidos', async () => {
  const tables = await driver.listTables()
  const names = tables.map((t) => t.name)
  assert.ok(names.includes('clientes'), JSON.stringify(names))
  assert.ok(names.includes('pedidos'))
  // O bug original passava aqui em silêncio: name === undefined.
  assert.ok(
    tables.every((t) => typeof t.name === 'string' && t.name.length > 0),
    JSON.stringify(tables)
  )
})

test('listTables distingue view de tabela', async () => {
  const tables = await driver.listTables()
  assert.equal(tables.find((t) => t.name === 'vw_resumo')?.type, 'view')
  assert.equal(tables.find((t) => t.name === 'clientes')?.type, 'table')
})

test('listColumns devolve nome, tipo e obrigatoriedade', async () => {
  const columns = await driver.listColumns('clientes')
  const names = columns.map((c) => c.name)
  assert.deepEqual(names, ['id', 'nome', 'email', 'cidade', 'criado_em'])

  const id = columns.find((c) => c.name === 'id')
  assert.equal(id.isPrimaryKey, true)
  assert.equal(id.nullable, false)
  assert.match(id.type, /int/)
  assert.match(id.extra, /auto_increment/)

  const nome = columns.find((c) => c.name === 'nome')
  assert.equal(nome.nullable, false)
  assert.equal(nome.type, 'varchar(120)')
  assert.equal(nome.comment, 'nome completo')

  assert.equal(columns.find((c) => c.name === 'email').nullable, true)
})

test('listColumns marca chave estrangeira', async () => {
  const columns = await driver.listColumns('pedidos')
  assert.equal(columns.find((c) => c.name === 'cliente_id').isForeignKey, true)
})

test('listIndexes agrupa colunas por índice', async () => {
  const indexes = await driver.listIndexes('pedidos')
  const names = indexes.map((i) => i.name)
  assert.ok(names.includes('PRIMARY'), JSON.stringify(names))
  assert.ok(names.includes('idx_status'))
  assert.equal(indexes.find((i) => i.name === 'PRIMARY').primary, true)
  assert.deepEqual(indexes.find((i) => i.name === 'idx_status').columns, ['status'])
})

test('listRelations resolve a chave estrangeira', async () => {
  const relations = await driver.listRelations('pedidos')
  assert.equal(relations.length, 1)
  assert.equal(relations[0].column, 'cliente_id')
  assert.equal(relations[0].referencedTable, 'clientes')
  assert.equal(relations[0].referencedColumn, 'id')
  assert.equal(relations[0].onDelete, 'CASCADE')
})

test('query executa SELECT e infere tipos', async () => {
  const [result] = await driver.query('SELECT id, nome, criado_em FROM clientes ORDER BY id', {
    queryId: 'q1'
  })
  assert.equal(result.rowCount, 3)
  assert.equal(result.columns.find((c) => c.name === 'id').type, 'number')
  assert.equal(result.columns.find((c) => c.name === 'nome').type, 'string')
  assert.equal(result.columns.find((c) => c.name === 'criado_em').type, 'date')
  assert.equal(result.rows[0][1], 'Ana')
})

test('query executa JOIN com agregação', async () => {
  const [result] = await driver.query(
    `SELECT c.cidade, COUNT(*) AS total, SUM(p.valor) AS soma
     FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
     GROUP BY c.cidade ORDER BY total DESC`,
    { queryId: 'q2' }
  )
  assert.equal(result.rowCount, 2)
  assert.equal(result.rows[0][1], 2)
})

test('DECIMAL chega como número, não string', async () => {
  const [result] = await driver.query('SELECT valor FROM pedidos ORDER BY id LIMIT 1', {
    queryId: 'q3'
  })
  assert.equal(typeof result.rows[0][0], 'number')
  assert.equal(result.rows[0][0], 199.9)
})

test('NULL atravessa como null', async () => {
  const [result] = await driver.query('SELECT email FROM clientes WHERE nome = ?', {
    queryId: 'q4'
  }).catch(() => driver.query("SELECT email FROM clientes WHERE nome = 'Bruno'", { queryId: 'q4' }))
  assert.equal(result.rows[0][0], null)
})

test('DATETIME é serializado como string ISO', async () => {
  const [result] = await driver.query('SELECT criado_em FROM clientes LIMIT 1', { queryId: 'q5' })
  assert.equal(typeof result.rows[0][0], 'string')
  assert.match(result.rows[0][0], /^\d{4}-\d{2}-\d{2}T/)
})

test('colunas homônimas de JOIN não se sobrescrevem', async () => {
  // Sem `rowsAsArray`, o segundo `id` apagaria o primeiro e a UI mostraria
  // uma coluna a menos, sem nenhum aviso.
  const [result] = await driver.query(
    'SELECT c.id, p.id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id ORDER BY p.id LIMIT 1',
    { queryId: 'q11' }
  )
  assert.equal(result.columns.length, 2)
  assert.equal(result.rows[0].length, 2)
})

test('lote de statements devolve um resultado por statement', async () => {
  const results = await driver.query('SELECT 1 AS a; SELECT 2 AS b;', { queryId: 'q6' })
  assert.equal(results.length, 2)
  assert.equal(results[0].rows[0][0], 1)
  assert.equal(results[1].rows[0][0], 2)
})

test('SELECT sem LIMIT devolve só a prévia de 100 linhas', async () => {
  // A tabela tem 3 linhas, então validamos que o LIMIT injetado é aceito pelo
  // servidor e não altera o resultado quando ele já cabe na prévia.
  const [result] = await driver.query('SELECT * FROM pedidos', { queryId: 'p1' })
  assert.equal(result.rowCount, 3)
})

test('LIMIT explícito é respeitado, não substituído pela prévia', async () => {
  const [result] = await driver.query('SELECT * FROM pedidos LIMIT 2', { queryId: 'p2' })
  assert.equal(result.rowCount, 2)
})

test('a prévia realmente limita no servidor', async () => {
  // Gera 500 linhas e confirma que sem LIMIT voltam 100, não 500.
  await driver.query(
    `INSERT INTO pedidos (cliente_id, valor, status)
     SELECT 1, 1.0, 'novo' FROM information_schema.columns LIMIT 500`,
    { queryId: 'p3' }
  )
  const [semLimite] = await driver.query('SELECT * FROM pedidos', { queryId: 'p4' })
  assert.equal(semLimite.rowCount, 100)

  const [comLimite] = await driver.query('SELECT * FROM pedidos LIMIT 300', { queryId: 'p5' })
  assert.equal(comLimite.rowCount, 300)

  await driver.query('DELETE FROM pedidos WHERE valor = 1.0', { queryId: 'p6' })
})

test('maxRows corta o resultado e sinaliza', async () => {
  const [result] = await driver.query('SELECT * FROM pedidos', { queryId: 'q7', maxRows: 2 })
  assert.equal(result.rowCount, 2)
  assert.equal(result.truncatedAt, 2)
})

test('UPDATE devolve linhas afetadas', async () => {
  const [result] = await driver.query(
    "UPDATE pedidos SET status = 'pago' WHERE id = 2",
    { queryId: 'q8' }
  )
  assert.equal(result.affectedRows, 1)
  assert.equal(result.columns.length, 0)
})

test('modo somente-leitura bloqueia escrita no driver', async () => {
  const ro = new MySQLDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.query("DELETE FROM pedidos WHERE id = 999", { queryId: 'q9' }),
    /somente-leitura/
  )
  await ro.disconnect()
})

test('erro de coluna inexistente sobe com código do MySQL', async () => {
  await assert.rejects(
    () => driver.query('SELECT coluna_que_nao_existe FROM clientes', { queryId: 'q10' }),
    (error) => error.code === 'ER_BAD_FIELD_ERROR'
  )
})
