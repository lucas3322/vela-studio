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

test('listAllRelations traz o mapa inteiro numa consulta só', async () => {
  // A modelagem precisa de todas as FKs de uma vez: com `listRelations` seriam
  // 211 idas ao banco só para desenhar a primeira tela.
  const todas = await driver.listAllRelations()
  const nossa = todas.filter((r) => r.table === 'pedidos')
  assert.equal(nossa.length, 1)
  assert.equal(nossa[0].column, 'cliente_id')
  assert.equal(nossa[0].referencedTable, 'clientes')
  assert.equal(nossa[0].referencedColumn, 'id')
  assert.equal(nossa[0].onDelete, 'CASCADE')
})

test('listAllRelations diz de qual tabela cada FK sai', async () => {
  // Sem o campo `table` as relações chegam indistinguíveis e o diagrama não
  // sabe de onde puxar a linha.
  const todas = await driver.listAllRelations()
  assert.ok(todas.length > 0)
  for (const r of todas) {
    assert.ok(typeof r.table === 'string' && r.table.length > 0, JSON.stringify(r))
    assert.ok(typeof r.referencedTable === 'string' && r.referencedTable.length > 0)
  }
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

// ── edição de dados ──────────────────────────────────────────────────

test('updateCell altera uma linha pela chave primária', async () => {
  const antes = await driver.query("SELECT nome FROM clientes WHERE id = 1", { queryId: 'e0' })
  const r = await driver.updateCell({
    table: 'clientes', column: 'nome', value: 'Ana Editada', keys: { id: 1 }
  })
  assert.equal(r.affectedRows, 1)
  const [depois] = await driver.query('SELECT nome FROM clientes WHERE id = 1', { queryId: 'e1' })
  assert.equal(depois.rows[0][0], 'Ana Editada')
  // devolve ao valor original
  await driver.updateCell({ table: 'clientes', column: 'nome', value: antes[0].rows[0][0], keys: { id: 1 } })
})

test('updateCell grava NULL', async () => {
  await driver.updateCell({ table: 'clientes', column: 'email', value: null, keys: { id: 1 } })
  const [r] = await driver.query('SELECT email FROM clientes WHERE id = 1', { queryId: 'e2' })
  assert.equal(r.rows[0][0], null)
  await driver.updateCell({ table: 'clientes', column: 'email', value: 'ana@x.com', keys: { id: 1 } })
})

test('updateCell recusa chave vazia', async () => {
  await assert.rejects(
    () => driver.updateCell({ table: 'clientes', column: 'nome', value: 'x', keys: {} }),
    /chave prim/i
  )
})

test('updateCell recusa chave nula', async () => {
  await assert.rejects(
    () => driver.updateCell({ table: 'clientes', column: 'nome', value: 'x', keys: { id: null } }),
    /nula/i
  )
})

test('o valor é parametrizado, não concatenado no SQL', async () => {
  // Se houvesse concatenação, esta string fecharia a aspa e viraria comando.
  const veneno = "'; DROP TABLE clientes; --"
  await driver.updateCell({ table: 'clientes', column: 'nome', value: veneno, keys: { id: 2 } })
  const [r] = await driver.query('SELECT nome FROM clientes WHERE id = 2', { queryId: 'e3' })
  assert.equal(r.rows[0][0], veneno, 'o valor precisa ter sido gravado literalmente')
  const [ainda] = await driver.query('SELECT COUNT(*) FROM clientes', { queryId: 'e4' })
  assert.ok(Number(ainda.rows[0][0]) >= 3, 'a tabela precisa continuar existindo')
  await driver.updateCell({ table: 'clientes', column: 'nome', value: 'Bruno', keys: { id: 2 } })
})

test('modo somente-leitura bloqueia a edição em grade', async () => {
  const ro = new MySQLDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.updateCell({ table: 'clientes', column: 'nome', value: 'x', keys: { id: 1 } }),
    /somente-leitura/
  )
  await assert.rejects(() => ro.deleteRow({ table: 'clientes', keys: { id: 1 } }), /somente-leitura/)
  await ro.disconnect()
})

test('deleteRow remove exatamente uma linha', async () => {
  await driver.query("INSERT INTO clientes (nome, cidade) VALUES ('Descartavel','X')", { queryId: 'e5' })
  const [novo] = await driver.query("SELECT id FROM clientes WHERE nome = 'Descartavel'", { queryId: 'e6' })
  const id = novo.rows[0][0]

  const r = await driver.deleteRow({ table: 'clientes', keys: { id } })
  assert.equal(r.affectedRows, 1)

  const [sumiu] = await driver.query(`SELECT COUNT(*) FROM clientes WHERE id = ${id}`, { queryId: 'e7' })
  assert.equal(Number(sumiu.rows[0][0]), 0)
})

test('operação que pegaria mais de uma linha é desfeita', async () => {
  // A garantia central da edição em grade: se a "chave" não identificar uma
  // linha só, nada é gravado. Sem isso, editar uma célula numa tabela sem PK
  // real reescreveria a coluna inteira em silêncio.
  await driver.query(
    "UPDATE clientes SET cidade = 'Duplicada' WHERE id IN (1,2)",
    { queryId: 'rb0' }
  )
  await assert.rejects(
    () => driver.updateCell({
      table: 'clientes', column: 'cidade', value: 'Nao Deve Gravar',
      keys: { cidade: 'Duplicada' }
    }),
    /afetaria 2 linhas/
  )
  const [conf] = await driver.query(
    "SELECT COUNT(*) FROM clientes WHERE cidade = 'Duplicada'", { queryId: 'rb1' }
  )
  assert.equal(Number(conf.rows[0][0]), 2, 'o UPDATE precisa ter sido desfeito')

  await assert.rejects(
    () => driver.deleteRow({ table: 'clientes', keys: { cidade: 'Duplicada' } }),
    /afetaria 2 linhas/
  )
  const [aindaLa] = await driver.query(
    "SELECT COUNT(*) FROM clientes WHERE cidade = 'Duplicada'", { queryId: 'rb2' }
  )
  assert.equal(Number(aindaLa.rows[0][0]), 2, 'o DELETE precisa ter sido desfeito')
})

// ── Alteração de tipo de coluna ──────────────────────────────────────

test('o ALTER reemite NOT NULL, DEFAULT e COMMENT', async () => {
  // A armadilha do MySQL: `MODIFY COLUMN c VARCHAR(50)` sozinho APAGA a
  // obrigatoriedade, o padrão e o comentário da coluna, sem erro nenhum.
  await driver.query(
    `ALTER TABLE clientes MODIFY COLUMN cidade VARCHAR(80) NOT NULL DEFAULT 'Recife' COMMENT 'cidade natal';`,
    { queryId: 'ac0' }
  )

  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'cidade', newType: 'varchar(120)'
  })

  assert.match(sql, /varchar\(120\)/i)
  assert.match(sql, /NOT NULL/, 'a obrigatoriedade precisa ser reemitida')
  assert.match(sql, /DEFAULT 'Recife'/, 'o padrão precisa ser reemitido')
  assert.match(sql, /COMMENT 'cidade natal'/, 'o comentário precisa ser reemitido')
})

test('o ALTER montado realmente preserva os atributos ao rodar', async () => {
  // Não basta o texto conter as palavras: o teste roda o comando e relê o
  // catálogo. É a única prova de que nada se perdeu.
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'cidade', newType: 'varchar(140)'
  })
  await driver.query(sql, { queryId: 'ac1' })

  const colunas = await driver.listColumns('clientes')
  const cidade = colunas.find((c) => c.name === 'cidade')
  assert.equal(cidade.type, 'varchar(140)')
  assert.equal(cidade.nullable, false, 'NOT NULL não pode ter sumido')
  assert.equal(cidade.defaultValue, 'Recife', 'o DEFAULT não pode ter sumido')
  assert.equal(cidade.comment, 'cidade natal', 'o COMMENT não pode ter sumido')
})

test('coluna que aceita nulo continua aceitando', async () => {
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'email', newType: 'varchar(200)'
  })
  await driver.query(sql, { queryId: 'ac2' })
  const email = (await driver.listColumns('clientes')).find((c) => c.name === 'email')
  assert.equal(email.type, 'varchar(200)')
  assert.equal(email.nullable, true, 'não pode virar NOT NULL do nada')
})

test('AUTO_INCREMENT da chave primária sobrevive', async () => {
  // Perder o auto_increment quebra todo INSERT seguinte da aplicação.
  // Numa tabela sem FK apontando para ela — ver o teste seguinte para o
  // que acontece quando existe uma.
  await driver.query(
    'DROP TABLE IF EXISTS solta; CREATE TABLE solta (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(10));',
    { queryId: 'ac3a' }
  )
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'solta', column: 'id', newType: 'bigint'
  })
  assert.match(sql, /AUTO_INCREMENT/i, JSON.stringify(sql))
  await driver.query(sql, { queryId: 'ac3b' })

  const id = (await driver.listColumns('solta')).find((c) => c.name === 'id')
  assert.match(id.type, /bigint/)
  assert.match(id.extra, /auto_increment/, 'o auto_increment não pode ter sumido')
})

test('o banco recusa a troca quando uma chave estrangeira depende da coluna', async () => {
  // Cenário real: `pedidos.cliente_id` referencia `clientes.id`. Mudar só um
  // lado deixaria os tipos incompatíveis, e o MySQL barra — corretamente.
  // O que importa para a IDE é que o erro chegue, e não que a gente tente
  // contornar por conta própria.
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'id', newType: 'bigint'
  })
  await assert.rejects(() => driver.query(sql, { queryId: 'ac3c' }), /incompatible|foreign key/i)

  // E a coluna continua exatamente como estava.
  const id = (await driver.listColumns('clientes')).find((c) => c.name === 'id')
  assert.match(id.type, /^int/, 'o tipo não pode ter mudado')
  assert.match(id.extra, /auto_increment/)
})

test('tipo com formato inválido é recusado antes de virar SQL', async () => {
  // O tipo é interpolado no DDL — não existe placeholder para tipo. A barreira
  // de forma é o que impede emendar um segundo comando.
  for (const veneno of ["varchar(20); DROP TABLE clientes; --", "varchar(20)'", '', '   ']) {
    await assert.rejects(
      () => driver.buildAlterColumnTypeStatement({
        table: 'clientes', column: 'cidade', newType: veneno
      }),
      /tipo/i,
      `deveria recusar: ${JSON.stringify(veneno)}`
    )
  }
  const [ainda] = await driver.query('SELECT COUNT(*) FROM clientes', { queryId: 'ac4' })
  assert.ok(Number(ainda.rows[0][0]) >= 3, 'a tabela precisa continuar existindo')
})

// ── precedência do LIMIT ─────────────────────────────────────────────

test('o LIMIT da consulta vence a preferência de visualização', async () => {
  // O bug relatado: com a preferência em 100, `LIMIT 5000` devolvia 100 e a
  // tela não dizia que o comando do usuário tinha sido ignorado.
  await driver.query(
    `DROP TABLE IF EXISTS muitas;
     CREATE TABLE muitas (id INT PRIMARY KEY AUTO_INCREMENT);
     INSERT INTO muitas (id) SELECT NULL FROM information_schema.columns LIMIT 600;`,
    { queryId: 'lim0' }
  )

  const [r] = await driver.query('SELECT * FROM muitas LIMIT 500', {
    queryId: 'lim1',
    previewRows: 100
  })
  assert.equal(r.rowCount, 500, 'o LIMIT escrito na consulta precisa valer')
  assert.equal(r.truncatedAt, undefined, 'nada foi cortado, então não há aviso de corte')
})

test('sem LIMIT, a preferência corta e o corte é sinalizado', async () => {
  const [r] = await driver.query('SELECT * FROM muitas', { queryId: 'lim2', previewRows: 50 })
  assert.equal(r.rowCount, 50)
  assert.equal(r.truncatedAt, 50, 'a UI precisa saber que faltam linhas')
})

test('maxRows do chamador continua sendo teto absoluto', async () => {
  // É o que a exportação usa; a preferência não pode reduzi-lo.
  const [r] = await driver.query('SELECT * FROM muitas', {
    queryId: 'lim3',
    maxRows: 300,
    previewRows: 50
  })
  assert.equal(r.rowCount, 300)
})
