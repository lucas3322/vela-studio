/**
 * Teste de ponta a ponta do RedisDriver contra um Redis real.
 *
 * Subir o banco:
 *   docker run -d --name vela-redis-test -p 63791:6379 redis:7
 *
 * Rodar: npm run test:redis
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { RedisDriver } from './.redis-bundle.mjs'

const config = {
  id: 'test',
  name: 'test',
  driver: 'redis',
  host: '127.0.0.1',
  port: 63791,
  database: '0'
}

const driver = new RedisDriver()

function coluna(result, nome) {
  return result.columns.findIndex((c) => c.name === nome)
}

before(async () => {
  await driver.connect(config)
  // O teste semeia as próprias chaves: depender de estado deixado por uma
  // rodada anterior já fez suíte de outro driver falhar inteira só porque o
  // container tinha sido recriado.
  await driver.query(
    [
      'DEL vela:str vela:hash vela:list vela:set vela:zset vela:expira vela:del',
      'SET vela:str "valor inicial"',
      'HSET vela:hash campo1 um campo2 dois',
      'RPUSH vela:list a b c',
      'SADD vela:set x y z',
      'ZADD vela:zset 1 baixo 5 alto 3 meio',
      'SET vela:expira temporario',
      'EXPIRE vela:expira 100',
      'SET vela:del apague-me'
    ].join('; '),
    { queryId: 'seed' }
  )
})

after(async () => {
  await driver.disconnect()
})

test('testConnection reporta versão e latência', async () => {
  const probe = new RedisDriver()
  const result = await probe.testConnection(config)
  assert.equal(result.ok, true)
  assert.match(result.serverVersion, /^\d+\./)
  assert.equal(typeof result.latencyMs, 'number')
  await probe.disconnect()
})

test('testConnection reporta host inalcançável sem travar', async () => {
  const probe = new RedisDriver()
  const result = await probe.testConnection({ ...config, port: 29999 })
  assert.equal(result.ok, false)
  await probe.disconnect()
})

test('serverVersion devolve a versão do servidor', async () => {
  const version = await driver.serverVersion()
  assert.match(version, /^\d+\./)
})

test('listDatabases devolve uma lista de índices', async () => {
  const databases = await driver.listDatabases()
  assert.ok(Array.isArray(databases))
  assert.ok(databases.includes('0'), JSON.stringify(databases))
})

test('listTables devolve as cinco pseudo-tabelas', async () => {
  const tables = await driver.listTables()
  const names = tables.map((t) => t.name).sort()
  assert.deepEqual(names, ['hashes', 'lists', 'sets', 'sorted-sets', 'strings'])
  assert.ok(tables.every((t) => t.type === 'collection'))
  assert.ok(tables.every((t) => t.rowCount === undefined))
})

test('listColumns devolve sempre key, value e ttl', async () => {
  for (const table of ['strings', 'hashes', 'lists', 'sets', 'sorted-sets']) {
    const columns = await driver.listColumns(table)
    assert.deepEqual(columns.map((c) => c.name), ['key', 'value', 'ttl'])
    assert.equal(columns[0].isPrimaryKey, true)
    assert.equal(columns[0].nullable, false)
    assert.equal(columns[1].nullable, false)
    assert.equal(columns[2].nullable, true)
  }
})

test('listColumns marca o tipo de "value" como string só nas strings', async () => {
  const strings = await driver.listColumns('strings')
  assert.equal(strings[1].type, 'string')

  for (const table of ['hashes', 'lists', 'sets', 'sorted-sets']) {
    const columns = await driver.listColumns(table)
    assert.equal(columns[1].type, 'json', table)
  }
})

test('listColumns recusa nome de pseudo-tabela desconhecido', async () => {
  await assert.rejects(() => driver.listColumns('nao-existe'), /não é uma pseudo-tabela/)
})

test('listIndexes, listRelations e listAllRelations devolvem vazio', async () => {
  assert.deepEqual(await driver.listIndexes('strings'), [])
  assert.deepEqual(await driver.listRelations('strings'), [])
  assert.deepEqual(await driver.listAllRelations(), [])
})

test('getCreateStatement e buildAlterColumnTypeStatement recusam com mensagem clara', async () => {
  await assert.rejects(() => driver.getCreateStatement('strings'), /DDL/)
  await assert.rejects(() => driver.buildAlterColumnTypeStatement({ table: 'strings', column: 'value', newType: 'x' }), /tipo de coluna/)
})

test('buildDangerStatement descreve as duas fases, nunca instrui FLUSHDB', () => {
  const texto = driver.buildDangerStatement('truncate', 'hashes')
  assert.match(texto, /SCAN/)
  assert.match(texto, /DEL/)
  assert.match(texto, /TYPE hash/)
  // O texto pode *mencionar* FLUSHDB para deixar claro que não é isso que
  // está sendo feito — o que não pode existir é um passo que rode FLUSHDB.
  assert.doesNotMatch(texto, /^\s*FLUSHDB\b/m)
})

test('query traz o valor de uma string', async () => {
  const [result] = await driver.query('GET vela:str', { queryId: 'q1' })
  assert.equal(result.rows[0][coluna(result, 'resultado')], 'valor inicial')
})

test('query com múltiplos comandos separados por ; roda cada um', async () => {
  const results = await driver.query('SET vela:multi1 a; SET vela:multi2 b; GET vela:multi1', {
    queryId: 'q2'
  })
  assert.equal(results.length, 3)
  assert.equal(results[2].rows[0][coluna(results[2], 'resultado')], 'a')
})

test('query com argumento entre aspas preserva o espaço', async () => {
  await driver.query('SET "vela:chave composta" "valor com espaço"', { queryId: 'q3' })
  const [result] = await driver.query('GET "vela:chave composta"', { queryId: 'q4' })
  assert.equal(result.rows[0][coluna(result, 'resultado')], 'valor com espaço')
})

test('SCAN <pseudo-tabela> monta o grid de key/value/ttl', async () => {
  const [result] = await driver.query('SCAN strings MATCH vela:str', { queryId: 'q5' })
  assert.equal(result.columns.map((c) => c.name).join(','), 'key,value,ttl')
  assert.equal(result.rowCount, 1)
  assert.equal(result.rows[0][0], 'vela:str')
  assert.equal(result.rows[0][1], 'valor inicial')
  assert.equal(result.rows[0][2], null)
})

test('SCAN de hash devolve o objeto inteiro como JSON', async () => {
  const [result] = await driver.query('SCAN hashes MATCH vela:hash', { queryId: 'q6' })
  assert.equal(result.rowCount, 1)
  assert.deepEqual(result.rows[0][1], { campo1: 'um', campo2: 'dois' })
})

test('SCAN de lista preserva a ordem', async () => {
  const [result] = await driver.query('SCAN lists MATCH vela:list', { queryId: 'q7' })
  assert.deepEqual(result.rows[0][1], ['a', 'b', 'c'])
})

test('SCAN de set devolve os membros', async () => {
  const [result] = await driver.query('SCAN sets MATCH vela:set', { queryId: 'q8' })
  assert.deepEqual(result.rows[0][1].sort(), ['x', 'y', 'z'])
})

test('SCAN de sorted-set devolve pares member/score ordenados por score', async () => {
  const [result] = await driver.query('SCAN sorted-sets MATCH vela:zset', { queryId: 'q9' })
  assert.deepEqual(result.rows[0][1], [
    { member: 'baixo', score: 1 },
    { member: 'meio', score: 3 },
    { member: 'alto', score: 5 }
  ])
})

test('SCAN mostra o ttl de uma chave com expiração', async () => {
  const [result] = await driver.query('SCAN strings MATCH vela:expira', { queryId: 'q10' })
  assert.ok(result.rows[0][2] > 0 && result.rows[0][2] <= 100, result.rows[0][2])
})

test('updateCell em "value" preserva o TTL existente (KEEPTTL)', async () => {
  await driver.query('SET vela:comttl "original"; EXPIRE vela:comttl 500', { queryId: 'seed-ttl' })
  const ttlAntes = await driver.query('TTL vela:comttl', { queryId: 'ttl-antes' })
  assert.ok(ttlAntes[0].rows[0][0] > 0)

  await driver.updateCell({
    table: 'strings',
    column: 'value',
    value: 'novo valor',
    keys: { key: 'vela:comttl' }
  })

  const [depois] = await driver.query('GET vela:comttl', { queryId: 'get-depois' })
  assert.equal(depois.rows[0][0], 'novo valor')

  const [ttlDepois] = await driver.query('TTL vela:comttl', { queryId: 'ttl-depois' })
  assert.ok(ttlDepois.rows[0][0] > 0, `TTL deveria sobreviver à edição, veio ${ttlDepois.rows[0][0]}`)
})

test('updateCell em "value" de um hash reconstrói preservando o TTL', async () => {
  await driver.query('DEL vela:hashttl; HSET vela:hashttl a 1; EXPIRE vela:hashttl 300', {
    queryId: 'seed-hashttl'
  })

  await driver.updateCell({
    table: 'hashes',
    column: 'value',
    value: JSON.stringify({ b: '2', c: '3' }),
    keys: { key: 'vela:hashttl' }
  })

  const [result] = await driver.query('SCAN hashes MATCH vela:hashttl', { queryId: 'check-hashttl' })
  assert.deepEqual(result.rows[0][1], { b: '2', c: '3' })
  assert.ok(result.rows[0][2] > 0, 'TTL do hash deveria sobreviver à reescrita')
})

test('updateCell em "ttl" define uma nova expiração', async () => {
  await driver.query('SET vela:setttl x', { queryId: 'seed-setttl' })
  await driver.updateCell({
    table: 'strings',
    column: 'ttl',
    value: 60,
    keys: { key: 'vela:setttl' }
  })
  const [result] = await driver.query('TTL vela:setttl', { queryId: 'check-setttl' })
  assert.ok(result.rows[0][0] > 0 && result.rows[0][0] <= 60)
})

test('updateCell em "ttl" com valor nulo remove a expiração (PERSIST)', async () => {
  await driver.query('SET vela:persist x; EXPIRE vela:persist 100', { queryId: 'seed-persist' })
  await driver.updateCell({
    table: 'strings',
    column: 'ttl',
    value: null,
    keys: { key: 'vela:persist' }
  })
  const [result] = await driver.query('TTL vela:persist', { queryId: 'check-persist' })
  assert.equal(result.rows[0][0], -1)
})

test('insertRow cria uma chave de cada tipo', async () => {
  await driver.query(
    'DEL vela:novo:str vela:novo:hash vela:novo:list vela:novo:set vela:novo:zset',
    { queryId: 'clean-insert' }
  )

  await driver.insertRow({ table: 'strings', values: { key: 'vela:novo:str', value: 'abc' } })
  await driver.insertRow({
    table: 'hashes',
    values: { key: 'vela:novo:hash', value: JSON.stringify({ x: '1' }) }
  })
  await driver.insertRow({
    table: 'lists',
    values: { key: 'vela:novo:list', value: JSON.stringify(['a', 'b']) }
  })
  await driver.insertRow({
    table: 'sets',
    values: { key: 'vela:novo:set', value: JSON.stringify(['m', 'n']) }
  })
  await driver.insertRow({
    table: 'sorted-sets',
    values: {
      key: 'vela:novo:zset',
      value: JSON.stringify([{ member: 'a', score: 1 }]),
      ttl: 120
    }
  })

  const [str] = await driver.query('GET vela:novo:str', { queryId: 'chk1' })
  assert.equal(str.rows[0][0], 'abc')

  const [hash] = await driver.query('SCAN hashes MATCH vela:novo:hash', { queryId: 'chk2' })
  assert.deepEqual(hash.rows[0][1], { x: '1' })

  const [zsetTtl] = await driver.query('TTL vela:novo:zset', { queryId: 'chk3' })
  assert.ok(zsetTtl.rows[0][0] > 0)
})

test('insertRow recusa chave que já existe', async () => {
  await driver.query('SET vela:existente x', { queryId: 'seed-existente' })
  await assert.rejects(
    () => driver.insertRow({ table: 'strings', values: { key: 'vela:existente', value: 'y' } }),
    /já existe/
  )
})

test('deleteRow remove a chave', async () => {
  const antes = await driver.query('EXISTS vela:del', { queryId: 'antes-del' })
  assert.equal(antes[0].rows[0][0], 1)

  const resultado = await driver.deleteRow({ table: 'strings', keys: { key: 'vela:del' } })
  assert.equal(resultado.affectedRows, 1)

  const depois = await driver.query('EXISTS vela:del', { queryId: 'depois-del' })
  assert.equal(depois[0].rows[0][0], 0)
})

test('modo somente-leitura bloqueia escrita e permite leitura', async () => {
  const ro = new RedisDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.query('SET vela:ro x', { queryId: 'ro1' }),
    /somente-leitura/
  )
  const [ok] = await ro.query('GET vela:str', { queryId: 'ro2' })
  assert.equal(ok.rows[0][0], 'valor inicial')
  await ro.disconnect()
})

test('modo somente-leitura também bloqueia updateCell/insertRow/deleteRow', async () => {
  const ro = new RedisDriver()
  await ro.connect({ ...config, readOnly: true })
  await assert.rejects(
    () => ro.updateCell({ table: 'strings', column: 'value', value: 'x', keys: { key: 'vela:str' } }),
    /somente-leitura/
  )
  await assert.rejects(
    () => ro.insertRow({ table: 'strings', values: { key: 'vela:ro:novo', value: 'x' } }),
    /somente-leitura/
  )
  await assert.rejects(
    () => ro.deleteRow({ table: 'strings', keys: { key: 'vela:str' } }),
    /somente-leitura/
  )
  await ro.disconnect()
})

test('cancel não derruba a conexão nem lança erro', async () => {
  await assert.doesNotReject(() => driver.cancel('id-qualquer'))
})
