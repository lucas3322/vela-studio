/**
 * Teste de ponta a ponta do MongoDriver contra um MongoDB real.
 *
 * Subir o banco:
 *   docker run -d --name vela-mongo-test -p 27018:27017 mongo:7
 *
 * Rodar: npm run test:mongo
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { MongoDriver } from './.mongo-bundle.mjs'

const config = {
  id: 'test',
  name: 'test',
  driver: 'mongodb',
  connectionString: 'mongodb://127.0.0.1:27018',
  database: 'lojinha'
}

const driver = new MongoDriver()

before(async () => {
  await driver.connect(config)
  await driver.query('db.clientes.deleteMany({})', { queryId: 'clean1' })
  await driver.query('db.pedidos.deleteMany({})', { queryId: 'clean2' })
  await driver.query(
    `db.clientes.insertMany([
      { nome: "Ana", email: "ana@x.com", cidade: "Sao Paulo", ativo: true, criadoEm: new Date("2024-01-10") },
      { nome: "Bruno", cidade: "Recife", ativo: false, criadoEm: new Date("2024-02-20") },
      { nome: "Celia", email: "c@x.com", cidade: "Curitiba", ativo: true, endereco: { rua: "A", numero: 10 } }
    ])`,
    { queryId: 'seed1' }
  )
  await driver.query(
    `db.pedidos.insertMany([
      { valor: 199.9, status: "pago" },
      { valor: 50, status: "novo" },
      { valor: 1200.55, status: "enviado" }
    ])`,
    { queryId: 'seed2' }
  )
})

after(async () => {
  await driver.disconnect()
})

test('testConnection reporta versão do servidor', async () => {
  const probe = new MongoDriver()
  const result = await probe.testConnection(config)
  assert.equal(result.ok, true)
  assert.match(result.serverVersion, /^\d+\./)
  await probe.disconnect()
})

test('testConnection reporta host inalcançável sem travar', async () => {
  const probe = new MongoDriver()
  const result = await probe.testConnection({
    ...config,
    connectionString: 'mongodb://127.0.0.1:29999/?serverSelectionTimeoutMS=1000'
  })
  assert.equal(result.ok, false)
  await probe.disconnect()
})

test('listTables devolve coleções com nome preenchido', async () => {
  const tables = await driver.listTables()
  const names = tables.map((t) => t.name)
  assert.ok(names.includes('clientes'), JSON.stringify(names))
  assert.ok(names.includes('pedidos'))
  assert.ok(tables.every((t) => t.type === 'collection'))
})

test('listColumns infere campos por amostragem', async () => {
  const columns = await driver.listColumns('clientes')
  const names = columns.map((c) => c.name)
  assert.ok(names.includes('_id'))
  assert.ok(names.includes('nome'))
  assert.ok(names.includes('cidade'))
  assert.equal(columns.find((c) => c.name === '_id').isPrimaryKey, true)
})

test('listColumns marca campo presente em parte dos documentos', async () => {
  const columns = await driver.listColumns('clientes')
  const email = columns.find((c) => c.name === 'email')
  // 2 dos 3 documentos têm email.
  assert.equal(email.frequency, 67)
  assert.equal(email.nullable, true)

  const nome = columns.find((c) => c.name === 'nome')
  assert.equal(nome.frequency, 100)
  assert.equal(nome.nullable, false)
})

test('listColumns achata campos aninhados', async () => {
  const columns = await driver.listColumns('clientes')
  assert.ok(columns.some((c) => c.name === 'endereco.rua'), JSON.stringify(columns.map((c) => c.name)))
})

test('listColumns identifica o tipo do campo', async () => {
  const columns = await driver.listColumns('clientes')
  assert.match(columns.find((c) => c.name === 'ativo').type, /boolean/)
  assert.match(columns.find((c) => c.name === 'criadoEm').type, /date/)
  assert.match(columns.find((c) => c.name === '_id').type, /ObjectId/)
})

test('listIndexes traz o índice implícito de _id', async () => {
  const indexes = await driver.listIndexes('clientes')
  const primary = indexes.find((i) => i.name === '_id_')
  assert.ok(primary, JSON.stringify(indexes))
  assert.equal(primary.primary, true)
  assert.deepEqual(primary.columns, ['_id'])
})

test('listRelations devolve vazio em vez de inventar relação', async () => {
  assert.deepEqual(await driver.listRelations('pedidos'), [])
})

test('find com filtro devolve os documentos certos', async () => {
  const [result] = await driver.query('db.clientes.find({ ativo: true })', { queryId: 'q1' })
  assert.equal(result.rowCount, 2)
})

test('find com sort e limit encadeados', async () => {
  const [result] = await driver.query('db.pedidos.find({}).sort({ valor: -1 }).limit(2)', {
    queryId: 'q2'
  })
  assert.equal(result.rowCount, 2)
  const valorIndex = result.columns.findIndex((c) => c.name === 'valor')
  assert.equal(result.rows[0][valorIndex], 1200.55)
})

test('filtro com operador $gt', async () => {
  const [result] = await driver.query('db.pedidos.find({ valor: { $gt: 100 } })', { queryId: 'q3' })
  assert.equal(result.rowCount, 2)
})

test('filtro com expressão regular funciona', async () => {
  // Este é o teste do bug de realm: com `vm.runInNewContext` a regex nascia
  // com outro protótipo, o BSON a descartava e o filtro virava `{}`.
  const [result] = await driver.query('db.clientes.find({ nome: /^A/ })', { queryId: 'q4' })
  assert.equal(result.rowCount, 1)
})

test('filtro por data funciona', async () => {
  const [result] = await driver.query(
    'db.clientes.find({ criadoEm: { $gte: new Date("2024-02-01") } })',
    { queryId: 'q5' }
  )
  assert.equal(result.rowCount, 1)
})

test('pipeline de agregação agrupa e soma', async () => {
  const [result] = await driver.query(
    'db.clientes.aggregate([{ $group: { _id: "$cidade", total: { $sum: 1 } } }, { $sort: { _id: 1 } }])',
    { queryId: 'q6' }
  )
  assert.equal(result.rowCount, 3)
})

test('countDocuments devolve a contagem', async () => {
  const [result] = await driver.query('db.clientes.countDocuments({})', { queryId: 'q7' })
  assert.equal(result.rows[0][0], 3)
})

test('documentos com chaves diferentes viram colunas unidas', async () => {
  // Bruno não tem email nem endereco; a união de chaves precisa cobrir todos.
  const [result] = await driver.query('db.clientes.find({})', { queryId: 'q8' })
  const names = result.columns.map((c) => c.name)
  assert.ok(names.includes('email'), JSON.stringify(names))
  assert.ok(names.includes('nome'))
  assert.equal(result.rowCount, 3)
})

test('ObjectId é serializado como string', async () => {
  const [result] = await driver.query('db.clientes.find({}).limit(1)', { queryId: 'q9' })
  const idIndex = result.columns.findIndex((c) => c.name === '_id')
  assert.equal(typeof result.rows[0][idIndex], 'string')
})

test('find sem limite explícito é cortado no teto', async () => {
  const [result] = await driver.query('db.clientes.find({})', { queryId: 'q10', maxRows: 2 })
  assert.equal(result.rowCount, 2)
  assert.equal(result.truncatedAt, 2)
})

test('updateOne devolve o resultado da operação', async () => {
  const [result] = await driver.query(
    'db.clientes.updateOne({ nome: "Ana" }, { $set: { ativo: false } })',
    { queryId: 'q11' }
  )
  const modifiedIndex = result.columns.findIndex((c) => c.name === 'modifiedCount')
  assert.equal(result.rows[0][modifiedIndex], 1)
})

test('modo somente-leitura bloqueia escrita', async () => {
  const ro = new MongoDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.query('db.clientes.deleteMany({})', { queryId: 'q12' }),
    /somente-leitura/
  )
  await ro.disconnect()
})

test('operação não suportada dá mensagem útil', async () => {
  await assert.rejects(
    () => driver.query('db.clientes.mapReduce({})', { queryId: 'q13' }),
    /não é suportada/
  )
})

test('edição em grade avisa que ainda não vale para o Mongo', async () => {
  // Documento não tem coluna: editar "célula" exigiria decidir o que fazer com
  // campos aninhados. Enquanto isso não existe, a mensagem tem que dizer o
  // caminho — não estourar um erro genérico.
  await assert.rejects(
    () => driver.updateCell({ table: 'clientes', column: 'nome', value: 'x', keys: { _id: '1' } }),
    /editor/i
  )
  await assert.rejects(
    () => driver.deleteRow({ table: 'clientes', keys: { _id: '1' } }),
    /editor/i
  )
})
