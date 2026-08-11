/**
 * Testes das partes que não têm UI para revelar um erro.
 *
 * O analisador de contexto e o splitter de statements são silenciosos quando
 * erram: o autocomplete só fica "meio burro" e ninguém descobre por quê.
 * Rode com: npm test
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  splitStatements,
  isMutation,
  isUnboundedMutation,
  hasExplicitLimit,
  applyPreviewLimit
} from '../main/drivers/types.ts'
import { translateError, nearest } from '../main/error-translator.ts'
import { parseMongoCommand, splitMongoCommands } from '../main/drivers/mongo-parser.ts'
import { analyze, extractTables, resolveQualifier } from '../renderer/src/editor/sql-context.ts'
import { formatSql } from '../renderer/src/editor/formatter.ts'

// ── splitStatements ──────────────────────────────────────────────────

test('separa statements simples', () => {
  assert.deepEqual(splitStatements('SELECT 1; SELECT 2'), ['SELECT 1', 'SELECT 2'])
})

test('ignora ponto e vírgula dentro de string', () => {
  assert.deepEqual(splitStatements("SELECT 'a;b' FROM t"), ["SELECT 'a;b' FROM t"])
})

test('ignora ponto e vírgula em comentário de linha', () => {
  assert.deepEqual(splitStatements('SELECT 1 -- comentário; falso\n'), [
    'SELECT 1 -- comentário; falso'
  ])
})

test('ignora ponto e vírgula em comentário de bloco', () => {
  assert.deepEqual(splitStatements('SELECT /* ; */ 1'), ['SELECT /* ; */ 1'])
})

test('preserva corpo de função com $$ do Postgres', () => {
  const sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 2"
  const statements = splitStatements(sql)
  assert.equal(statements.length, 2)
  assert.ok(statements[0].includes('RETURN 1;'))
  assert.equal(statements[1], 'SELECT 2')
})

test('trata aspas escapadas por duplicação', () => {
  assert.deepEqual(splitStatements("SELECT 'it''s; fine'"), ["SELECT 'it''s; fine'"])
})

// ── detecção de escrita ──────────────────────────────────────────────

test('reconhece comandos de escrita', () => {
  assert.equal(isMutation('UPDATE t SET a = 1'), true)
  assert.equal(isMutation('  -- nota\n  DELETE FROM t'), true)
  assert.equal(isMutation('SELECT * FROM t'), false)
})

test('detecta UPDATE e DELETE sem WHERE', () => {
  assert.equal(isUnboundedMutation('UPDATE clientes SET ativo = 0'), true)
  assert.equal(isUnboundedMutation('UPDATE clientes SET ativo = 0 WHERE id = 1'), false)
  assert.equal(isUnboundedMutation('DELETE FROM logs'), true)
  assert.equal(isUnboundedMutation('SELECT * FROM t'), false)
})

// ── contexto do cursor ───────────────────────────────────────────────

test('identifica a cláusula sob o cursor', () => {
  const sql = 'SELECT nome FROM clientes WHERE '
  assert.equal(analyze(sql, sql.length).clause, 'where')
  assert.equal(analyze('SELECT ', 7).clause, 'select')
  assert.equal(analyze('SELECT * FROM ', 14).clause, 'from')
})

test('extrai tabelas e apelidos', () => {
  const tables = extractTables(
    'SELECT * FROM contracts c INNER JOIN accounts a ON a.id = c.account_id'
  )
  assert.deepEqual(tables, [
    { name: 'contracts', alias: 'c' },
    { name: 'accounts', alias: 'a' }
  ])
})

test('não confunde palavra-chave com apelido', () => {
  const tables = extractTables('SELECT * FROM pedidos WHERE status = 1')
  assert.deepEqual(tables, [{ name: 'pedidos', alias: undefined }])
})

test('aceita AS explícito e nome citado', () => {
  const tables = extractTables('SELECT * FROM `meus dados` AS m')
  assert.deepEqual(tables, [{ name: 'meus dados', alias: 'm' }])
})

test('resolve apelido para o nome real da tabela', () => {
  const tables = extractTables('SELECT * FROM contracts c')
  assert.equal(resolveQualifier('c', tables), 'contracts')
  assert.equal(resolveQualifier('contracts', tables), 'contracts')
  assert.equal(resolveQualifier('x', tables), undefined)
})

test('detecta qualificador antes do cursor', () => {
  const sql = 'SELECT c. FROM contracts c'
  const context = analyze(sql, 9)
  assert.equal(context.qualifier, 'c')
  assert.equal(context.prefix, '')
})

test('isola o statement onde o cursor está', () => {
  const sql = 'SELECT 1; SELECT * FROM usuarios WHERE '
  const context = analyze(sql, sql.length)
  assert.equal(context.clause, 'where')
  assert.deepEqual(context.tables, [{ name: 'usuarios', alias: undefined }])
})

test('não lê tabela que está dentro de string', () => {
  const sql = "SELECT * FROM reais WHERE nome = 'FROM fantasma' AND "
  const context = analyze(sql, sql.length)
  assert.deepEqual(context.tables.map((t) => t.name), ['reais'])
})

test('reconhece lista de colunas do INSERT', () => {
  const sql = 'INSERT INTO clientes ('
  assert.equal(analyze(sql, sql.length).clause, 'insertColumns')
})

// ── tradutor de erros ────────────────────────────────────────────────

test('traduz tabela inexistente e sugere a mais próxima', () => {
  const error = Object.assign(new Error("Table 'db.contract' doesn't exist"), {
    code: 'ER_NO_SUCH_TABLE'
  })
  const result = translateError(error, { driver: 'mysql', knownTables: ['contracts', 'accounts'] })
  assert.match(result.friendly, /não existe/)
  assert.match(result.hint ?? '', /contracts/)
})

test('traduz conexão recusada', () => {
  const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
    code: 'ECONNREFUSED'
  })
  const result = translateError(error, { driver: 'mysql' })
  assert.match(result.friendly, /recusou a conexão/)
})

test('mantém a mensagem crua quando não reconhece o erro', () => {
  const result = translateError(new Error('algo muito específico'), { driver: 'mysql' })
  assert.equal(result.friendly, 'algo muito específico')
  assert.equal(result.raw, 'algo muito específico')
})

test('só sugere nome quando está de fato próximo', () => {
  assert.equal(nearest('contract', ['contracts', 'accounts']), 'contracts')
  assert.equal(nearest('zzzzzz', ['contracts', 'accounts']), undefined)
})

// ── parser do MongoDB ────────────────────────────────────────────────

test('interpreta find com filtro e encadeamento', () => {
  const plan = parseMongoCommand('db.clientes.find({ ativo: true }).sort({ nome: 1 }).limit(10)')
  assert.equal(plan.collection, 'clientes')
  assert.equal(plan.method, 'find')
  assert.deepEqual(plan.args[0], { ativo: true })
  assert.deepEqual(
    plan.chain.map((c) => c.name),
    ['sort', 'limit']
  )
})

test('interpreta pipeline de agregação', () => {
  const plan = parseMongoCommand(
    'db.vendas.aggregate([{ $group: { _id: "$cidade", total: { $sum: 1 } } }])'
  )
  assert.equal(plan.method, 'aggregate')
  assert.equal(Array.isArray(plan.args[0]), true)
})

test('regex e data chegam com o protótipo do realm do processo', () => {
  // Se o parser rodasse em outro realm, estes `instanceof` falhariam — e o
  // serializador BSON descartaria silenciosamente o filtro.
  const plan = parseMongoCommand('db.clientes.find({ nome: /^Mar/i, criadoEm: new Date() })')
  const filter = plan.args[0] as { nome: unknown; criadoEm: unknown }
  assert.ok(filter.nome instanceof RegExp)
  assert.ok(filter.criadoEm instanceof Date)
})

test('objetos de filtro são objetos simples do realm atual', () => {
  const plan = parseMongoCommand('db.clientes.find({ ativo: true })')
  assert.equal(Object.getPrototypeOf(plan.args[0]), Object.prototype)
  assert.deepEqual(plan.args[0], { ativo: true })
})

test('os globais perigosos ficam sombreados', () => {
  assert.throws(() => parseMongoCommand('db.x.find({ a: process.env })'))
  assert.throws(() => parseMongoCommand('db.x.find({ a: require("fs") })'))
  assert.throws(() => parseMongoCommand('db.x.find({ a: globalThis.process })'))
})

test('recusa comando que não começa em db', () => {
  assert.throws(() => parseMongoCommand('console.log(1)'))
})

test('separa múltiplos comandos mongo', () => {
  const commands = splitMongoCommands('db.a.find({});\ndb.b.countDocuments({})')
  assert.deepEqual(commands, ['db.a.find({})', 'db.b.countDocuments({})'])
})

// ── formatador ───────────────────────────────────────────────────────

test('quebra cláusulas em linhas e normaliza para maiúscula', () => {
  const formatted = formatSql('select a, b from t where x = 1 and y = 2 order by a')
  const lines = formatted.split('\n')
  assert.ok(lines.some((l) => l.startsWith('SELECT')))
  assert.ok(lines.some((l) => l.startsWith('FROM')))
  assert.ok(lines.some((l) => l.startsWith('WHERE')))
  assert.ok(lines.some((l) => l.startsWith('ORDER BY')))
  // AND/OR também sobem, senão o resultado fica com dois padrões de caixa.
  assert.ok(lines.some((l) => l.trim().startsWith('AND')))
})

test('não reformata o conteúdo de strings', () => {
  const formatted = formatSql("SELECT * FROM t WHERE nome = 'from where select'")
  assert.ok(formatted.includes("'from where select'"))
})

// ── limite de prévia ─────────────────────────────────────────────────

test('detecta LIMIT explícito', () => {
  assert.equal(hasExplicitLimit('SELECT * FROM t LIMIT 10'), true)
  assert.equal(hasExplicitLimit('select * from t limit 10'), true)
  assert.equal(hasExplicitLimit('SELECT * FROM t FETCH FIRST 5 ROWS ONLY'), true)
  assert.equal(hasExplicitLimit('SELECT TOP 10 * FROM t'), true)
  assert.equal(hasExplicitLimit('SELECT * FROM t'), false)
})

test('não confunde a palavra limit dentro de comentário', () => {
  assert.equal(hasExplicitLimit('SELECT * FROM t -- sem limit aqui'), false)
  assert.equal(hasExplicitLimit('SELECT * FROM t /* limit */'), false)
})

test('acrescenta LIMIT a SELECT que não tem', () => {
  assert.equal(applyPreviewLimit('SELECT * FROM pedidos', 100), 'SELECT * FROM pedidos\nLIMIT 100')
})

test('respeita LIMIT já existente', () => {
  const sql = 'SELECT * FROM pedidos LIMIT 5000'
  assert.equal(applyPreviewLimit(sql, 100), sql)
})

test('remove o ponto e vírgula final antes de anexar', () => {
  assert.equal(applyPreviewLimit('SELECT 1;', 100), 'SELECT 1\nLIMIT 100')
})

test('anexa em nova linha para não ser engolido por comentário', () => {
  const out = applyPreviewLimit('SELECT * FROM t -- nota', 100)
  assert.ok(out.endsWith('\nLIMIT 100'), out)
})

test('não mexe em comando que não é leitura', () => {
  for (const sql of [
    'UPDATE t SET a = 1',
    'DELETE FROM t',
    'INSERT INTO t VALUES (1)',
    'SHOW FULL PROCESSLIST',
    'CREATE TABLE x (id INT)'
  ]) {
    assert.equal(applyPreviewLimit(sql, 100), sql, sql)
  }
})

test('não mexe onde um LIMIT no fim mudaria o sentido', () => {
  for (const sql of [
    "SELECT * FROM t INTO OUTFILE '/tmp/x'",
    'SELECT * FROM t FOR UPDATE',
    'SELECT * FROM t FOR SHARE'
  ]) {
    assert.equal(applyPreviewLimit(sql, 100), sql, sql)
  }
})

test('aceita CTE começando com WITH', () => {
  const out = applyPreviewLimit('WITH a AS (SELECT 1) SELECT * FROM a', 100)
  assert.ok(out.endsWith('\nLIMIT 100'), out)
})

// ── escopo do autocomplete ───────────────────────────────────────────
//
// Estes travam a regra que decide o que a lista pode oferecer. O provider em
// si depende do Monaco e não roda fora do navegador, mas a decisão sai toda do
// contexto — que é o que verificamos aqui.

test('SELECT antes do FROM não tem tabela em escopo', () => {
  // Sem tabela, a lista NÃO pode oferecer coluna: seriam todas as colunas do
  // banco. Num schema de 200 tabelas isso torna o autocomplete inútil.
  const sql = 'select acc'
  const contexto = analyze(sql, sql.length)
  assert.equal(contexto.clause, 'select')
  assert.deepEqual(contexto.tables, [])
})

test('com FROM escrito, o escopo é só a tabela da query', () => {
  const sql = 'select acc\nfrom accounts'
  const contexto = analyze(sql, 10) // cursor logo após "acc"
  assert.equal(contexto.clause, 'select')
  assert.deepEqual(contexto.tables.map((t) => t.name), ['accounts'])
})

test('o escopo do WHERE é a tabela do FROM', () => {
  const sql = 'select * from accounts where acc'
  const contexto = analyze(sql, sql.length)
  assert.equal(contexto.clause, 'where')
  assert.deepEqual(contexto.tables.map((t) => t.name), ['accounts'])
})

test('JOIN coloca as duas tabelas em escopo, com os apelidos', () => {
  const sql = 'select * from accounts a join contracts c on c.id = a.id where '
  const contexto = analyze(sql, sql.length)
  assert.deepEqual(contexto.tables, [
    { name: 'accounts', alias: 'a' },
    { name: 'contracts', alias: 'c' }
  ])
})

test('o qualificador restringe a uma única tabela', () => {
  const sql = 'select * from accounts a join contracts c on c.'
  const contexto = analyze(sql, sql.length)
  assert.equal(contexto.qualifier, 'c')
  assert.equal(resolveQualifier('c', contexto.tables), 'contracts')
})
