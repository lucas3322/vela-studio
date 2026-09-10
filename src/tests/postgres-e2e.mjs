/**
 * Teste de ponta a ponta do PostgresDriver contra um PostgreSQL real.
 *
 * Subir o banco:
 *   docker run -d --name vela-pg-test -e POSTGRES_PASSWORD=vela123 \
 *     -e POSTGRES_DB=lojinha -p 54321:5432 postgres:16
 *
 * Rodar: npm run test:postgres
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { PostgresDriver } from './.postgres-bundle.mjs'

const config = {
  id: 'test',
  name: 'test',
  driver: 'postgres',
  host: '127.0.0.1',
  port: 54321,
  user: 'postgres',
  password: 'vela123',
  database: 'lojinha'
}

const driver = new PostgresDriver()

before(async () => {
  await driver.connect(config)
  await driver.query(
    `DROP VIEW IF EXISTS vw_resumo;
     DROP TABLE IF EXISTS pedidos;
     DROP TABLE IF EXISTS clientes;
     CREATE TABLE clientes (
       id SERIAL PRIMARY KEY,
       nome VARCHAR(120) NOT NULL,
       email VARCHAR(180),
       cidade VARCHAR(80),
       criado_em TIMESTAMP DEFAULT NOW()
     );
     COMMENT ON COLUMN clientes.nome IS 'nome completo';
     CREATE TABLE pedidos (
       id SERIAL PRIMARY KEY,
       cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
       valor NUMERIC(10,2) NOT NULL,
       status VARCHAR(20) DEFAULT 'novo',
       dados JSONB
     );
     CREATE INDEX idx_pedidos_status ON pedidos(status);
     CREATE VIEW vw_resumo AS SELECT cidade, COUNT(*) t FROM clientes GROUP BY cidade;
     INSERT INTO clientes (nome, email, cidade) VALUES
       ('Ana','ana@x.com','Sao Paulo'),('Bruno',NULL,'Recife'),('Celia','c@x.com','Curitiba');
     INSERT INTO pedidos (cliente_id, valor, status, dados) VALUES
       (1,199.90,'pago','{"cupom":"X1"}'),(1,50.00,'novo',NULL),(2,1200.55,'enviado',NULL);`,
    { queryId: 'seed' }
  )
})

after(async () => {
  await driver.disconnect()
})

test('testConnection reporta versão do servidor', async () => {
  const probe = new PostgresDriver()
  const result = await probe.testConnection(config)
  assert.equal(result.ok, true)
  assert.match(result.serverVersion, /^\d+/)
  await probe.disconnect()
})

test('testConnection reporta senha errada', async () => {
  const probe = new PostgresDriver()
  const result = await probe.testConnection({ ...config, password: 'errada' })
  assert.equal(result.ok, false)
  await probe.disconnect()
})

test('listDatabases devolve SCHEMAS, não databases', async () => {
  // O seletor da barra lateral troca de contexto sem reconectar — no Postgres
  // quem tem essa propriedade é o schema. Devolver o nome do database aqui
  // fazia ele chegar em listTables() como schema, e a barra lateral aparecia
  // vazia enquanto as queries funcionavam.
  const schemas = await driver.listDatabases()
  assert.ok(schemas.includes('public'), JSON.stringify(schemas))
  assert.ok(!schemas.includes('lojinha'), 'não pode devolver nome de database')
})

test('o valor de listDatabases serve para listTables', async () => {
  // O round-trip que estava quebrado: o que a UI recebe do seletor precisa
  // ser aceito por listTables e devolver as tabelas de verdade.
  const [primeiro] = await driver.listDatabases()
  const tabelas = await driver.listTables(primeiro)
  assert.ok(tabelas.length > 0, `listTables("${primeiro}") devolveu vazio`)
  assert.ok(tabelas.some((t) => t.name === 'clientes'), JSON.stringify(tabelas.map((t) => t.name)))
})

test('listTables devolve nomes preenchidos e distingue view', async () => {
  const tables = await driver.listTables()
  const names = tables.map((t) => t.name)
  assert.ok(names.includes('clientes'), JSON.stringify(names))
  assert.ok(tables.every((t) => typeof t.name === 'string' && t.name.length > 0))
  assert.equal(tables.find((t) => t.name === 'vw_resumo').type, 'view')
})

test('listColumns traz tipo formatado e obrigatoriedade', async () => {
  const columns = await driver.listColumns('clientes')
  assert.deepEqual(columns.map((c) => c.name), ['id', 'nome', 'email', 'cidade', 'criado_em'])

  const id = columns.find((c) => c.name === 'id')
  assert.equal(id.isPrimaryKey, true)
  assert.equal(id.nullable, false)

  const nome = columns.find((c) => c.name === 'nome')
  assert.equal(nome.type, 'character varying(120)')
  assert.equal(nome.nullable, false)
  assert.equal(nome.comment, 'nome completo')

  assert.equal(columns.find((c) => c.name === 'email').nullable, true)
})

test('listColumns marca chave estrangeira', async () => {
  const columns = await driver.listColumns('pedidos')
  assert.equal(columns.find((c) => c.name === 'cliente_id').isForeignKey, true)
})

test('listIndexes agrupa colunas por índice', async () => {
  const indexes = await driver.listIndexes('pedidos')
  const found = indexes.find((i) => i.name === 'idx_pedidos_status')
  assert.ok(found, JSON.stringify(indexes))
  assert.deepEqual(found.columns, ['status'])
  assert.ok(indexes.some((i) => i.primary))
})

test('streamQuery percorre o cursor até o fim', async () => {
  const blocos = []
  await driver.streamQuery('SELECT id, nome FROM clientes ORDER BY id', {}, async (b) => {
    blocos.push(b)
  })
  const linhas = blocos.flatMap((b) => b.rows)
  assert.equal(linhas.length, 3)
  assert.deepEqual(blocos[0].columns, ['id', 'nome'])
})

test('streamQuery ignora a prévia e traz tudo', async () => {
  await driver.query('DROP TABLE IF EXISTS muitas', { queryId: 'd1' })
  await driver.query('CREATE TABLE muitas AS SELECT g AS id FROM generate_series(1, 500) g', {
    queryId: 'd2'
  })

  const [prevista] = await driver.query('SELECT * FROM muitas', { queryId: 'p' })
  assert.equal(prevista.rows.length, 100)

  let total = 0
  await driver.streamQuery('SELECT * FROM muitas', {}, async (b) => {
    total += b.rows.length
  })
  assert.equal(total, 500)

  await driver.query('DROP TABLE muitas', { queryId: 'd3' })
})

test('o cursor é fechado mesmo quando o consumidor falha', async () => {
  // Sem fechar, a transação ficaria aberta e a conexão presa no pool — o
  // sintoma seria a IDE parar de responder consultas depois de um erro.
  await assert.rejects(
    driver.streamQuery('SELECT * FROM clientes', {}, async () => {
      throw new Error('escrita em disco falhou')
    }),
    /escrita em disco falhou/
  )
  const [depois] = await driver.query('SELECT 1 AS ok', { queryId: 'apos' })
  assert.equal(Number(depois.rows[0][0]), 1, 'a conexão precisa continuar utilizável')
})

test('listAllRelations traz o mapa inteiro numa consulta só', async () => {
  const todas = await driver.listAllRelations()
  const nossa = todas.filter((r) => r.table === 'pedidos')
  assert.equal(nossa.length, 1)
  assert.equal(nossa[0].column, 'cliente_id')
  assert.equal(nossa[0].referencedTable, 'clientes')
  assert.equal(nossa[0].onDelete, 'CASCADE')
})

test('listAllRelations diz de qual tabela cada FK sai', async () => {
  const todas = await driver.listAllRelations()
  assert.ok(todas.length > 0)
  for (const r of todas) {
    assert.ok(typeof r.table === 'string' && r.table.length > 0, JSON.stringify(r))
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

test('NUMERIC chega como número, não string', async () => {
  const [result] = await driver.query('SELECT valor FROM pedidos ORDER BY id LIMIT 1', {
    queryId: 'q2'
  })
  assert.equal(typeof result.rows[0][0], 'number')
  assert.equal(result.rows[0][0], 199.9)
})

test('JSONB atravessa como objeto', async () => {
  const [result] = await driver.query(
    'SELECT dados FROM pedidos WHERE dados IS NOT NULL LIMIT 1',
    { queryId: 'q3' }
  )
  assert.deepEqual(result.rows[0][0], { cupom: 'X1' })
  assert.equal(result.columns[0].type, 'json')
})

test('NULL atravessa como null', async () => {
  const [result] = await driver.query("SELECT email FROM clientes WHERE nome = 'Bruno'", {
    queryId: 'q4'
  })
  assert.equal(result.rows[0][0], null)
})

test('colunas homônimas de JOIN não se sobrescrevem', async () => {
  // rowMode 'array' existe justamente por isto: com objetos, o segundo `id`
  // apagaria o primeiro e a UI mostraria uma coluna a menos.
  const [result] = await driver.query(
    'SELECT c.id, p.id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id ORDER BY p.id DESC LIMIT 1',
    { queryId: 'q5' }
  )
  assert.equal(result.columns.length, 2)
  assert.deepEqual(result.columns.map((c) => c.name), ['id', 'id'])
  assert.equal(result.rows[0].length, 2)
  // A última linha tem cliente 2 e pedido 3: os valores precisam ser distintos.
  assert.notEqual(result.rows[0][0], result.rows[0][1])
})

test('lote de statements devolve um resultado por statement', async () => {
  const results = await driver.query('SELECT 1 AS a; SELECT 2 AS b;', { queryId: 'q6' })
  assert.equal(results.length, 2)
  assert.equal(results[0].rows[0][0], 1)
})

test('maxRows corta o resultado e sinaliza', async () => {
  const [result] = await driver.query('SELECT * FROM pedidos', { queryId: 'q7', maxRows: 2 })
  assert.equal(result.rowCount, 2)
  assert.equal(result.truncatedAt, 2)
})

test('UPDATE devolve linhas afetadas', async () => {
  const [result] = await driver.query("UPDATE pedidos SET status = 'pago' WHERE id = 2", {
    queryId: 'q8'
  })
  assert.equal(result.affectedRows, 1)
  assert.equal(result.columns.length, 0)
})

test('modo somente-leitura bloqueia escrita', async () => {
  const ro = new PostgresDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.query('DELETE FROM pedidos WHERE id = 999', { queryId: 'q9' }),
    /somente-leitura/
  )
  await ro.disconnect()
})

test('erro de coluna inexistente sobe com mensagem do Postgres', async () => {
  await assert.rejects(
    () => driver.query('SELECT coluna_que_nao_existe FROM clientes', { queryId: 'q10' }),
    /does not exist/
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
  const ro = new PostgresDriver()
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

test('o ALTER de tipo preserva NOT NULL, default e comentário', async () => {
  // No Postgres o ALTER COLUMN ... TYPE mexe só no tipo — diferente do MySQL,
  // onde a definição inteira é reescrita. Este teste é a prova disso.
  //
  // Usa `email`, não `cidade`: a view vw_resumo depende de cidade, e o
  // Postgres recusa alterar coluna usada por view (ver o teste seguinte).
  await driver.query(
    `UPDATE clientes SET email = 'sem@email.com' WHERE email IS NULL;
     ALTER TABLE clientes ALTER COLUMN email SET NOT NULL;
     ALTER TABLE clientes ALTER COLUMN email SET DEFAULT 'sem@email.com';
     COMMENT ON COLUMN clientes.email IS 'email de contato';`,
    { queryId: 'ac0' }
  )

  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'email', newType: 'varchar(240)'
  })
  await driver.query(sql, { queryId: 'ac1' })

  const email = (await driver.listColumns('clientes')).find((c) => c.name === 'email')
  assert.equal(email.type, 'character varying(240)')
  assert.equal(email.nullable, false, 'NOT NULL não pode ter sumido')
  assert.match(String(email.defaultValue), /sem@email\.com/, 'o DEFAULT não pode ter sumido')
  assert.equal(email.comment, 'email de contato', 'o COMMENT não pode ter sumido')
})

test('o banco recusa alterar coluna usada por uma view', async () => {
  // vw_resumo agrupa por clientes.cidade. O Postgres barra, e o certo é o
  // erro chegar ao usuário — não tentarmos derrubar a view por conta própria.
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'cidade', newType: 'varchar(140)'
  })
  await assert.rejects(() => driver.query(sql, { queryId: 'ac1b' }), /view or rule/i)

  const cidade = (await driver.listColumns('clientes')).find((c) => c.name === 'cidade')
  assert.equal(cidade.type, 'character varying(80)', 'a coluna não pode ter mudado')
})

test('o ALTER qualifica a tabela com o schema', async () => {
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'nome', newType: 'varchar(200)'
  })
  assert.match(sql, /"public"\."clientes"/, sql)
})

test('conversão impossível é recusada pelo banco, com mensagem', async () => {
  // texto → inteiro precisa de USING. Não inventamos a expressão: escolher
  // por conta própria seria adivinhar a intenção sobre dado real.
  const sql = await driver.buildAlterColumnTypeStatement({
    table: 'clientes', column: 'nome', newType: 'integer'
  })
  await assert.rejects(() => driver.query(sql, { queryId: 'ac2' }), /USING|cannot be cast|não pode/i)

  const nome = (await driver.listColumns('clientes')).find((c) => c.name === 'nome')
  assert.match(nome.type, /character varying/, 'a coluna não pode ter mudado')
})

test('tipo com formato inválido é recusado antes de virar SQL', async () => {
  for (const veneno of ['varchar(20); DROP TABLE clientes; --', "varchar(20)'", '', '  ']) {
    await assert.rejects(
      () => driver.buildAlterColumnTypeStatement({
        table: 'clientes', column: 'cidade', newType: veneno
      }),
      /tipo/i,
      `deveria recusar: ${JSON.stringify(veneno)}`
    )
  }
  const [ainda] = await driver.query('SELECT COUNT(*) FROM clientes', { queryId: 'ac3' })
  assert.ok(Number(ainda.rows[0][0]) >= 3)
})

// ── insertRows (importação de arquivo) ──────────────────────────────

test('insertRows grava todas as linhas e deixa o SERIAL agir', async () => {
  await driver.query(
    `DROP TABLE IF EXISTS importados;
     CREATE TABLE importados (
       id SERIAL PRIMARY KEY,
       nome VARCHAR(80) NOT NULL,
       cidade VARCHAR(80)
     );`,
    { queryId: 'imp-setup' }
  )

  const linhas = Array.from({ length: 250 }, (_, i) => [`Pessoa ${i}`, `Cidade ${i % 5}`])
  const r = await driver.insertRows({ table: 'importados', columns: ['nome', 'cidade'], rows: linhas })
  assert.equal(r.affectedRows, 250)

  const [contagem] = await driver.query('SELECT COUNT(*) AS n FROM importados', { queryId: 'imp-count' })
  assert.equal(Number(contagem.rows[0][0]), 250)
})

test('insertRows recusa em conexão somente-leitura', async () => {
  const ro = new PostgresDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.insertRows({ table: 'importados', columns: ['nome'], rows: [['x']] }),
    /somente-leitura/
  )
  await ro.disconnect()
})

test('insertRows parametriza: injeção vira texto, não comando', async () => {
  const veneno = "O'Brien'; DROP TABLE importados; --"
  await driver.insertRows({ table: 'importados', columns: ['nome'], rows: [[veneno]] })
  const [guardado] = await driver.query(
    'SELECT nome FROM importados ORDER BY id DESC LIMIT 1',
    { queryId: 'imp-veneno' }
  )
  assert.equal(guardado.rows[0][0], veneno)
})

test('insertRows quebra em sub-lotes sem perder nem duplicar linha', async () => {
  await driver.query('DROP TABLE IF EXISTS muitas_linhas; CREATE TABLE muitas_linhas (id SERIAL PRIMARY KEY, v TEXT);', {
    queryId: 'imp-many-setup'
  })
  const linhas = Array.from({ length: 5000 }, (_, i) => [`v-${i}`])
  const r = await driver.insertRows({ table: 'muitas_linhas', columns: ['v'], rows: linhas })
  assert.equal(r.affectedRows, 5000)

  const [contagem] = await driver.query('SELECT COUNT(*) AS n FROM muitas_linhas', { queryId: 'imp-many-count' })
  assert.equal(Number(contagem.rows[0][0]), 5000)
  const [distintos] = await driver.query('SELECT COUNT(DISTINCT v) AS n FROM muitas_linhas', { queryId: 'imp-many-distinct' })
  assert.equal(Number(distintos.rows[0][0]), 5000, 'nenhuma linha pode ter se repetido')
})

// ── resyncSequence — a armadilha real do Postgres ────────────────────

test('sem reajuste, INSERT com id explícito deixa a sequência para trás e o próximo INSERT normal colide', async () => {
  await driver.query(
    `DROP TABLE IF EXISTS chave_explicita;
     CREATE TABLE chave_explicita (id SERIAL PRIMARY KEY, nome TEXT);`,
    { queryId: 'seq-setup' }
  )

  // Importação com id explícito, pulando a sequência de propósito — como um
  // dump que restaura ids antigos.
  await driver.insertRows({
    table: 'chave_explicita',
    columns: ['id', 'nome'],
    rows: [[50, 'Ana'], [51, 'Bruno']]
  })

  // Sem reajustar a sequência, o próximo INSERT "normal" do sistema (sem id,
  // contando com o DEFAULT) ainda tenta usar 1 — e colide com nada aqui
  // porque a tabela está vazia de 1 a 49, mas em uma tabela de produção que já
  // tinha ids baixos ocupados, isso é exatamente a colisão relatada.
  const [antes] = await driver.query(
    "SELECT nextval(pg_get_serial_sequence('chave_explicita', 'id')) AS proximo",
    { queryId: 'seq-check-antes' }
  )
  assert.ok(
    Number(antes.rows[0][0]) < 50,
    'a sequência não pode ter avançado sozinha com um id explícito'
  )
})

test('resyncSequence acha a sequência e a reajusta para o maior id da tabela', async () => {
  await driver.query(
    `DROP TABLE IF EXISTS chave_reajustada;
     CREATE TABLE chave_reajustada (id SERIAL PRIMARY KEY, nome TEXT);`,
    { queryId: 'seq2-setup' }
  )
  await driver.insertRows({
    table: 'chave_reajustada',
    columns: ['id', 'nome'],
    rows: [[10, 'Ana'], [37, 'Bruno'], [22, 'Celia']]
  })

  const nomeSequencia = await driver.resyncSequence({ table: 'chave_reajustada', column: 'id' })
  assert.match(nomeSequencia ?? '', /chave_reajustada_id_seq/)

  // Depois do reajuste, o próximo INSERT sem id precisa vir depois do maior
  // id gravado (37) — não colidir com 10, 22 ou 37.
  const r = await driver.insertRow({ table: 'chave_reajustada', values: { nome: 'Duda' } })
  assert.equal(r.affectedRows, 1)
  const [duda] = await driver.query("SELECT id FROM chave_reajustada WHERE nome = 'Duda'", {
    queryId: 'seq2-check'
  })
  assert.ok(Number(duda.rows[0][0]) > 37, `id da Duda (${duda.rows[0][0]}) precisa vir depois do maior id explícito`)
})

test('resyncSequence devolve undefined para coluna que não é serial', async () => {
  const resultado = await driver.resyncSequence({ table: 'chave_reajustada', column: 'nome' })
  assert.equal(resultado, undefined)
})
