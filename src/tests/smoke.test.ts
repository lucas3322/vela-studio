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
import {
  analyze,
  extractTables,
  resolveQualifier,
  sqlParaExecutar,
  statementAtOffset
} from '../renderer/src/editor/sql-context.ts'
import { formatSql } from '../renderer/src/editor/formatter.ts'
import { identificarBinario } from '../../scripts/after-pack.mjs'
import { compararVersoes, escolherAsset } from '../main/update-logic.ts'

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

// ── detector de binário nativo ───────────────────────────────────────
//
// É o guarda que impede um instalador sair com o .node da plataforma errada.
// Três vezes isso aconteceu em silêncio; o teste existe para provar que o
// detector realmente distingue os formatos, e não só que ele roda.

/** Monta um cabeçalho mínimo com os bytes que identificam cada formato. */
function cabecalho(bytes: number[]): Buffer {
  const b = Buffer.alloc(32)
  bytes.forEach((v, i) => (b[i] = v))
  return b
}

test('reconhece Mach-O arm64 (macOS Apple Silicon)', () => {
  // magic 0xFEEDFACF little-endian, cputype 0x0100000C
  const b = cabecalho([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01])
  assert.deepEqual(identificarBinario(b), { plataforma: 'darwin', arch: 'arm64' })
})

test('reconhece Mach-O x86_64 (macOS Intel)', () => {
  const b = cabecalho([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01])
  assert.deepEqual(identificarBinario(b), { plataforma: 'darwin', arch: 'x64' })
})

test('reconhece PE do Windows', () => {
  const b = cabecalho([0x4d, 0x5a]) // 'MZ'
  assert.equal(identificarBinario(b).plataforma, 'win32')
})

test('reconhece ELF do Linux', () => {
  // 0x7F 'E' 'L' 'F'; byte 18 = máquina (0x3E = x86-64, 0xB7 = aarch64)
  const x64 = cabecalho([0x7f, 0x45, 0x4c, 0x46])
  x64[18] = 0x3e
  assert.deepEqual(identificarBinario(x64), { plataforma: 'linux', arch: 'x64' })

  const arm = cabecalho([0x7f, 0x45, 0x4c, 0x46])
  arm[18] = 0xb7
  assert.deepEqual(identificarBinario(arm), { plataforma: 'linux', arch: 'arm64' })
})

test('distingue as plataformas entre si', () => {
  // O caso real: um ELF do Linux dentro de um pacote macOS precisa ser
  // reconhecido como linux, nunca como darwin.
  const elf = cabecalho([0x7f, 0x45, 0x4c, 0x46])
  elf[18] = 0xb7
  assert.notEqual(identificarBinario(elf).plataforma, 'darwin')
})

test('não confunde lixo com binário válido', () => {
  assert.equal(identificarBinario(cabecalho([0, 1, 2, 3])).plataforma, 'desconhecida')
})

// ── Atualização pelo app ─────────────────────────────────────────────

const asset = (name: string): { name: string; browser_download_url: string; size: number } => ({
  name,
  browser_download_url: `https://exemplo/${name}`,
  size: 1
})

// Copiado da resposta real da API do GitHub para a release v0.2.0.
//
// Repare no ponto onde o electron-builder põe espaço: o `artifactName` gera
// "Vela Studio-0.2.0-arm64.dmg", e o GitHub troca o espaço por ponto no
// upload. O código precisa casar com o nome de *lá*, não com o do disco —
// testar com o nome local validaria uma ficção.
const RELEASE = [
  asset('vela-studio_0.2.0_amd64.deb'),
  asset('Vela.Studio-0.2.0-arm64.dmg'),
  asset('Vela.Studio-0.2.0-portable.exe'),
  asset('Vela.Studio-0.2.0-setup.exe'),
  asset('Vela.Studio-0.2.0-x64.dmg'),
  asset('Vela.Studio-0.2.0.AppImage')
]

test('escolherAsset respeita a arquitetura do macOS', () => {
  assert.equal(escolherAsset(RELEASE, 'darwin', 'arm64')?.name, 'Vela.Studio-0.2.0-arm64.dmg')
  assert.equal(escolherAsset(RELEASE, 'darwin', 'x64')?.name, 'Vela.Studio-0.2.0-x64.dmg')
})

test('escolherAsset também casa com o nome local, antes do upload', () => {
  const local = [asset('Vela Studio-0.2.0-arm64.dmg')]
  assert.equal(escolherAsset(local, 'darwin', 'arm64')?.name, 'Vela Studio-0.2.0-arm64.dmg')
})

test('sem o DMG da arquitetura, escolherAsset devolve nada', () => {
  // A regra que mais importa: um DMG arm64 com binário x86_64 dentro instala,
  // abre e falha dizendo que o app está danificado. Melhor não oferecer nada.
  const soIntel = [asset('Vela.Studio-0.2.0-x64.dmg')]
  assert.equal(escolherAsset(soIntel, 'darwin', 'arm64'), undefined)
})

test('escolherAsset prefere o instalador ao portável no Windows', () => {
  assert.equal(escolherAsset(RELEASE, 'win32', 'x64')?.name, 'Vela.Studio-0.2.0-setup.exe')
  const soPortavel = [asset('Vela.Studio-0.2.0-portable.exe')]
  assert.equal(escolherAsset(soPortavel, 'win32', 'x64')?.name, 'Vela.Studio-0.2.0-portable.exe')
})

test('escolherAsset não confunde o zip com o instalador do mac', () => {
  // O zip existe só como insumo de atualização automática; abri-lo não instala nada.
  const soZip = [asset('Vela.Studio-0.2.0-arm64.zip')]
  assert.equal(escolherAsset(soZip, 'darwin', 'arm64'), undefined)
})

test('escolherAsset acha o AppImage no Linux', () => {
  assert.equal(escolherAsset(RELEASE, 'linux', 'x64')?.name, 'Vela.Studio-0.2.0.AppImage')
})

test('compararVersoes ordena por major, minor e patch', () => {
  assert.ok(compararVersoes('0.3.0', '0.2.9') > 0)
  assert.ok(compararVersoes('1.0.0', '0.99.99') > 0)
  assert.ok(compararVersoes('0.2.10', '0.2.9') > 0, 'comparação numérica, não alfabética')
  assert.equal(compararVersoes('0.2.0', '0.2.0'), 0)
})

test('compararVersoes ignora o "v" da tag do GitHub', () => {
  assert.equal(compararVersoes('v0.2.0', '0.2.0'), 0)
})

test('pré-lançamento perde da versão final', () => {
  // Sem esta regra os dois empatariam nos números, e quem instalasse um beta
  // nunca seria avisado da estável que veio depois.
  assert.ok(compararVersoes('0.3.0', '0.3.0-beta.1') > 0)
  assert.ok(compararVersoes('0.3.0-beta.1', '0.3.0') < 0)
  assert.ok(compararVersoes('0.3.0-beta.2', '0.3.0-beta.1') > 0)
})

test('versão publicada igual à instalada não vira atualização', () => {
  assert.ok(compararVersoes('v0.2.0', '0.2.0') <= 0)
  assert.ok(compararVersoes('v0.1.9', '0.2.0') <= 0, 'release antiga não pode empurrar downgrade')
})

// ── O que o ⌘↵ executa ───────────────────────────────────────────────
//
// Esta regra já quebrou em produção: o ⌘↵ disparava a aba inteira, e um
// usuário rodou tudo achando que rodava uma query. Os testes abaixo existem
// para isso não voltar em silêncio.

const CADERNO = [
  "SELECT * FROM clientes;",
  "UPDATE pedidos SET status = 'pago';",
  "SELECT COUNT(*) FROM pedidos;"
].join('\n')

test('sem seleção, roda só o statement sob o cursor', () => {
  const noPrimeiro = sqlParaExecutar({ texto: CADERNO, offset: 10 })
  assert.equal(noPrimeiro, 'SELECT * FROM clientes')

  const noTerceiro = sqlParaExecutar({ texto: CADERNO, offset: CADERNO.length - 5 })
  assert.equal(noTerceiro, 'SELECT COUNT(*) FROM pedidos')
})

test('o cursor num SELECT não dispara o UPDATE vizinho', () => {
  // O motivo de a regra existir. Rodar a aba toda aqui alteraria a tabela.
  const executado = sqlParaExecutar({ texto: CADERNO, offset: 5 })
  assert.ok(!/UPDATE/i.test(executado ?? ''), `não pode incluir o UPDATE: ${executado}`)
})

test('a seleção vence o cursor', () => {
  // Cursor no primeiro statement, seleção apontando para outro trecho:
  // quem selecionou mandou.
  const executado = sqlParaExecutar({
    texto: CADERNO,
    offset: 5,
    selecao: 'SELECT COUNT(*) FROM pedidos'
  })
  assert.equal(executado, 'SELECT COUNT(*) FROM pedidos')
})

test('seleção parcial roda exatamente o que foi selecionado', () => {
  // Selecionar meia linha é uma intenção explícita — não completamos nada.
  const executado = sqlParaExecutar({ texto: CADERNO, offset: 0, selecao: 'SELECT 1 + 1' })
  assert.equal(executado, 'SELECT 1 + 1')
})

test('seleção só de espaço em branco cai para o statement do cursor', () => {
  const executado = sqlParaExecutar({ texto: CADERNO, offset: 10, selecao: '   \n  ' })
  assert.equal(executado, 'SELECT * FROM clientes')
})

test('nada executável devolve undefined em vez de string vazia', () => {
  assert.equal(sqlParaExecutar({ texto: ';;', offset: 1 }), undefined)
  assert.equal(sqlParaExecutar({ texto: '   ', offset: 1 }), undefined)
})

test('ponto e vírgula dentro de string não corta o statement', () => {
  // Sem tratar aspas, o cursor depois do ';' literal executaria um pedaço solto.
  const sql = "SELECT * FROM logs WHERE msg = 'erro; grave' AND id = 7"
  const executado = sqlParaExecutar({ texto: sql, offset: sql.length - 1 })
  assert.equal(executado, sql)
})

test('statementAtOffset devolve o início do statement', () => {
  const { start } = statementAtOffset(CADERNO, CADERNO.length - 5)
  assert.ok(start > 0)
  assert.equal(CADERNO.slice(start).trim(), 'SELECT COUNT(*) FROM pedidos;')
})
