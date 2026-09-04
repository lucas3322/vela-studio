/**
 * "Gerar INSERT" das linhas marcadas na grade.
 *
 * O ponto delicado é o mesmo do filtro: escapar direito o que o usuário não
 * escreveu (o dado vindo do banco), e escolher a sintaxe certa por dialeto —
 * SQL, Mongo e Redis não têm nem o mesmo verbo.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  gerarComandosRedis,
  gerarInsertMongo,
  gerarInsertSql
} from '../renderer/src/editor/gerar-insert.ts'

test('um INSERT por linha, não um multi-linha só', () => {
  const sql = gerarInsertSql(
    'clientes',
    ['id', 'nome'],
    [
      [1, 'Ana'],
      [2, 'Beto']
    ],
    'mysql'
  )
  assert.equal(
    sql,
    "INSERT INTO `clientes` (`id`, `nome`) VALUES (1, 'Ana');\n" +
      "INSERT INTO `clientes` (`id`, `nome`) VALUES (2, 'Beto');"
  )
})

test('identificador e literal citados conforme o dialeto', () => {
  const sql = gerarInsertSql('t', ['a'], [['x']], 'postgres')
  assert.match(sql, /INSERT INTO "t" \("a"\) VALUES \('x'\);/)
})

test('NULL entra sem aspas', () => {
  const sql = gerarInsertSql('t', ['a', 'b'], [[1, null]], 'mysql')
  assert.match(sql, /VALUES \(1, NULL\);/)
})

test('aspa simples no valor é dobrada, não encerra o literal', () => {
  const sql = gerarInsertSql('t', ['nome'], [["O'Brien"]], 'mysql')
  assert.match(sql, /'O''Brien'/)
})

test('número entra sem aspas e alinha com o literal numérico', () => {
  const sql = gerarInsertSql('t', ['preco'], [[19.9]], 'sqlite')
  assert.match(sql, /VALUES \(19\.9\);/)
})

test('boolean vira TRUE/FALSE, não 1/0 — Postgres não converte inteiro sozinho', () => {
  const sql = gerarInsertSql('t', ['ativo'], [[true], [false]], 'postgres')
  assert.match(sql, /VALUES \(TRUE\);/)
  assert.match(sql, /VALUES \(FALSE\);/)
})

test('coluna JSON vira o texto do JSON, como literal', () => {
  const sql = gerarInsertSql('t', ['dados'], [[{ a: 1 }]], 'mysql')
  assert.match(sql, /VALUES \('\{"a":1\}'\);/)
})

test('Mongo: um insertOne por linha, objeto formatado', () => {
  const js = gerarInsertMongo('usuarios', ['nome', 'idade'], [['Ana', 30]])
  assert.equal(js, 'db.usuarios.insertOne({\n  "nome": "Ana",\n  "idade": 30\n});')
})

// ── Redis ──────────────────────────────────────────────────────────────

test('Redis strings: SET simples sem TTL', () => {
  const cmd = gerarComandosRedis('strings', ['key', 'value', 'ttl'], [['sessao:1', 'abc', null]])
  assert.equal(cmd, 'SET "sessao:1" "abc"')
})

test('Redis strings: SET com EX quando a linha tem TTL', () => {
  const cmd = gerarComandosRedis('strings', ['key', 'value', 'ttl'], [['sessao:1', 'abc', 60]])
  assert.equal(cmd, 'SET "sessao:1" "abc" EX 60')
})

test('Redis hashes: HSET a partir do objeto', () => {
  const cmd = gerarComandosRedis(
    'hashes',
    ['key', 'value', 'ttl'],
    [['user:1', { nome: 'Ana', idade: 30 }, null]]
  )
  assert.equal(cmd, 'HSET "user:1" "nome" "Ana" "idade" "30"')
})

test('Redis lists: RPUSH na ordem do array', () => {
  const cmd = gerarComandosRedis('lists', ['key', 'value', 'ttl'], [['fila', ['a', 'b', 'c'], null]])
  assert.equal(cmd, 'RPUSH "fila" "a" "b" "c"')
})

test('Redis sets: SADD', () => {
  const cmd = gerarComandosRedis('sets', ['key', 'value', 'ttl'], [['tags', ['x', 'y'], null]])
  assert.equal(cmd, 'SADD "tags" "x" "y"')
})

test('Redis sorted sets: ZADD alternando nota e membro', () => {
  const cmd = gerarComandosRedis(
    'sorted-sets',
    ['key', 'value', 'ttl'],
    [['ranking', [{ member: 'ana', score: 10 }, { member: 'bia', score: 20 }], null]]
  )
  assert.equal(cmd, 'ZADD "ranking" 10 "ana" 20 "bia"')
})

test('Redis: valor com espaço fica cotado, tokenizador entende de volta', () => {
  const cmd = gerarComandosRedis('strings', ['key', 'value', 'ttl'], [['k', 'valor com espaço', null]])
  assert.equal(cmd, 'SET "k" "valor com espaço"')
})
