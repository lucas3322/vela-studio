/**
 * Montagem do WHERE da barra de filtro rápido.
 *
 * É o único lugar do app onde texto digitado pelo usuário vira SQL sem passar
 * por parâmetro — a barra existe justamente para quem não escreve SQL, então
 * um escape furado aqui vira comando executado sem ninguém perceber.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  citarIdentificador,
  citarLiteral,
  condicaoUsavel,
  montarFiltroMongo,
  montarWhere,
  valorParaMongo,
  type Condicao
} from '../renderer/src/editor/filter-builder.ts'

const c = (coluna: string, operador: Condicao['operador'], valor = ''): Condicao => ({
  coluna,
  operador,
  valor
})

test('sem condição completa, não há WHERE', () => {
  assert.equal(montarWhere([], 'mysql'), '')
  assert.equal(montarWhere([c('nome', 'igual', '')], 'mysql'), '')
  assert.equal(montarWhere([c('', 'igual', 'x')], 'mysql'), '')
})

test('operador de nulo não precisa de valor', () => {
  assert.equal(condicaoUsavel(c('email', 'vazio')), true)
  assert.equal(montarWhere([c('email', 'vazio')], 'mysql'), 'WHERE `email` IS NULL')
  assert.equal(montarWhere([c('email', 'naoVazio')], 'postgres'), 'WHERE "email" IS NOT NULL')
})

test('condições se juntam com AND', () => {
  const sql = montarWhere([c('cidade', 'igual', 'Recife'), c('email', 'naoVazio')], 'mysql')
  assert.equal(sql, "WHERE `cidade` = 'Recife' AND `email` IS NOT NULL")
})

test('número entra sem aspas, texto entra com', () => {
  assert.equal(montarWhere([c('id', 'igual', '42')], 'mysql'), 'WHERE `id` = 42')
  assert.equal(montarWhere([c('id', 'igual', '-3.5')], 'mysql'), 'WHERE `id` = -3.5')
  assert.equal(montarWhere([c('cep', 'igual', '01310-100')], 'mysql'), "WHERE `cep` = '01310-100'")
})

// ── escape: a parte que não pode falhar ──────────────────────────────

test('aspa simples no valor é dobrada, não encerra o literal', () => {
  for (const dialect of ['mysql', 'postgres', 'sqlite'] as const) {
    const sql = montarWhere([c('nome', 'igual', "O'Brien")], dialect)
    assert.match(sql, /'O''Brien'/, dialect)
  }
})

test('barra invertida é dobrada só no MySQL', () => {
  // No MySQL a barra escapa dentro de literal: sem dobrar, um valor terminado
  // em `\` engoliria a aspa de fechamento e o resto viraria comando.
  assert.equal(citarLiteral('c:\\temp', 'mysql'), "'c:\\\\temp'")
  // No Postgres e no SQLite ela é caractere comum — dobrar mudaria o valor.
  assert.equal(citarLiteral('c:\\temp', 'postgres'), "'c:\\temp'")
  assert.equal(citarLiteral('c:\\temp', 'sqlite'), "'c:\\temp'")
})

test('tentativa clássica de injeção não fecha o literal', () => {
  const veneno = "'; DROP TABLE clientes; --"
  for (const dialect of ['mysql', 'postgres', 'sqlite'] as const) {
    const sql = montarWhere([c('nome', 'igual', veneno)], dialect)
    // O valor inteiro precisa continuar dentro de um literal só: nenhuma aspa
    // solta, e o `;` não pode aparecer fora dele.
    const literais = sql.match(/'(?:[^']|'')*'/g) ?? []
    assert.equal(literais.length, 1, `${dialect}: ${sql}`)
    assert.ok(!sql.replace(literais[0], '').includes(';'), `${dialect}: ${sql}`)
    assert.ok(!/DROP TABLE clientes;/.test(sql.replace(literais[0], '')), dialect)
  }
})

test('a saída do MySQL com barra + aspa continua um literal só', () => {
  const sql = montarWhere([c('nome', 'igual', "a\\' OR 1=1 --")], 'mysql')
  const literais = sql.match(/'(?:[^'\\]|\\.|'')*'/g) ?? []
  assert.equal(literais.length, 1, sql)
})

test('nome de coluna com aspa é citado, não quebra o identificador', () => {
  assert.equal(citarIdentificador('meu`campo', 'mysql'), '`meu``campo`')
  assert.equal(citarIdentificador('meu"campo', 'postgres'), '"meu""campo"')
  assert.equal(citarIdentificador('com espaço', 'mysql'), '`com espaço`')
})

// ── LIKE ─────────────────────────────────────────────────────────────

test('contém vira LIKE com curingas nas pontas', () => {
  assert.match(montarWhere([c('nome', 'contem', 'ana')], 'mysql'), /LIKE '%ana%' ESCAPE/)
  assert.match(montarWhere([c('nome', 'comeca', 'ana')], 'mysql'), /LIKE 'ana%' ESCAPE/)
  assert.match(montarWhere([c('nome', 'termina', 'ana')], 'mysql'), /LIKE '%ana' ESCAPE/)
})

test('% e _ digitados são procurados como texto, não como curinga', () => {
  // Quem busca "50%" quer a string, não "qualquer coisa começando com 50".
  const sql = montarWhere([c('desconto', 'contem', '50%')], 'postgres')
  assert.ok(sql.includes("'%50\\%%'"), sql)

  const comSublinhado = montarWhere([c('cod', 'contem', 'a_b')], 'postgres')
  assert.ok(comSublinhado.includes("'%a\\_b%'"), comSublinhado)
})

test('o caractere do ESCAPE é citado conforme o dialeto', () => {
  // Escrever ESCAPE '\' à mão gerava, no MySQL, um literal sem terminar: a
  // barra escapa a própria aspa de fechamento e o comando quebra.
  const mysql = montarWhere([c('nome', 'contem', 'ana')], 'mysql')
  assert.ok(mysql.endsWith("ESCAPE '\\\\'"), mysql)

  // No Postgres e no SQLite a barra não escapa dentro de literal.
  for (const dialect of ['postgres', 'sqlite'] as const) {
    const sql = montarWhere([c('nome', 'contem', 'ana')], dialect)
    assert.ok(sql.endsWith("ESCAPE '\\'"), `${dialect}: ${sql}`)
  }
})

test('o LIKE do MySQL sai como um literal fechado', () => {
  // Verificação estrutural: contando as aspas simples não escapadas, o
  // comando precisa ter número par delas.
  const sql = montarWhere([c('nome', 'contem', "50% do O'Brien")], 'mysql')
  const aspas = (sql.match(/'/g) ?? []).length
  assert.equal(aspas % 2, 0, `aspas ímpares — literal aberto: ${sql}`)
})

// ── MongoDB ──────────────────────────────────────────────────────────

test('Mongo: sem condição, filtro vazio', () => {
  assert.equal(montarFiltroMongo([]), '{}')
})

test('Mongo: igualdade e nulo', () => {
  assert.equal(montarFiltroMongo([c('cidade', 'igual', 'Recife')]), '{ "cidade": "Recife" }')
  assert.equal(montarFiltroMongo([c('email', 'vazio')]), '{ "email": null }')
  assert.equal(montarFiltroMongo([c('id', 'igual', '7')]), '{ "id": 7 }')
})

test('Mongo: caractere de regex no valor é escapado', () => {
  // Sem escapar, buscar "a.b" casaria "axb" — resultado errado em silêncio.
  const filtro = montarFiltroMongo([c('nome', 'contem', 'a.b')])
  assert.match(filtro, /\$regex/)
  assert.ok(filtro.includes('a\\\\.b'), filtro)
})

test('Mongo: aspas no valor não quebram o objeto', () => {
  const filtro = montarFiltroMongo([c('nome', 'igual', 'diz "oi"')])
  assert.doesNotThrow(() => JSON.parse(filtro))
})

// ── tipo do campo no Mongo ───────────────────────────────────────────

test('campo de texto é citado, mesmo quando o valor parece número', () => {
  // O bug relatado: MSISDN guardado como texto, filtro montado com número, e
  // o Mongo devolvendo zero documento sem reclamar. Um MSISDN, um CPF, um CEP
  // sem hífen — tudo isso parece número e é guardado como texto.
  const filtro = montarFiltroMongo([c('MSISDN', 'igual', '5519983017492')], {
    MSISDN: 'string'
  })
  assert.equal(filtro, '{ "MSISDN": "5519983017492" }')
})

test('campo numérico continua indo como número', () => {
  const filtro = montarFiltroMongo([c('PARENT_ID', 'igual', '10000')], {
    PARENT_ID: 'number'
  })
  assert.equal(filtro, '{ "PARENT_ID": 10000 }')
})

test('campo numérico com valor de texto não vira número inválido', () => {
  const filtro = montarFiltroMongo([c('PARENT_ID', 'igual', 'abc')], { PARENT_ID: 'number' })
  assert.equal(filtro, '{ "PARENT_ID": "abc" }')
})

test('campo misto procura pelos dois tipos', () => {
  // Coleção migrada no meio da vida: documentos antigos com número, novos com
  // texto. Procurar por um só acha metade, e é a metade errada com igual
  // probabilidade. `$in` continua usando o índice.
  const filtro = montarFiltroMongo([c('MSISDN', 'igual', '5519983017492')], {
    MSISDN: 'string | number'
  })
  assert.match(filtro, /\$in/)
  assert.ok(filtro.includes('5519983017492'), filtro)
  assert.ok(filtro.includes('"5519983017492"'), filtro)
})

test('campo misto na negação usa $nin, não $ne', () => {
  // `$ne` com um tipo só deixaria passar os documentos do outro tipo —
  // exatamente os que a pessoa queria excluir.
  const filtro = montarFiltroMongo([c('MSISDN', 'diferente', '55199')], {
    MSISDN: 'string | number'
  })
  assert.match(filtro, /\$nin/)
})

test('sem informação de tipo, mantém o comportamento antigo', () => {
  // Coleção vazia, ou campo que não apareceu na amostra: sem schema não há o
  // que consultar, e o formato do texto é o único palpite disponível.
  assert.equal(montarFiltroMongo([c('x', 'igual', '42')]), '{ "x": 42 }')
  assert.equal(montarFiltroMongo([c('x', 'igual', 'ana')]), '{ "x": "ana" }')
})

test('o tipo não atrapalha os operadores de nulo', () => {
  assert.equal(
    montarFiltroMongo([c('MSISDN', 'vazio')], { MSISDN: 'string' }),
    '{ "MSISDN": null }'
  )
})

test('valorParaMongo decide sozinho, e é testável à parte', () => {
  assert.equal(valorParaMongo('123', 'string'), '"123"')
  assert.equal(valorParaMongo('123', 'number'), '123')
  assert.equal(valorParaMongo('123', 'ObjectId'), '123')
  assert.equal(valorParaMongo('  123  ', 'string'), '"123"', 'precisa aparar o espaço')
})

// ── datas e condições no mesmo campo (Mongo) ─────────────────────────────

const SP = 'America/Sao_Paulo'

test('campo de data vira ISODate com o deslocamento do fuso escrito', () => {
  // Antes saía `$gt: "2025-08-01 00:00:00"` — texto comparado com Date, que no
  // Mongo nunca casa. O filtro voltava vazio e dizia "sucesso".
  assert.equal(
    montarFiltroMongo([c('ACTIVATION_DATE', 'maior', '2025-08-01 00:00:00')], { ACTIVATION_DATE: 'date' }, SP),
    '{ "ACTIVATION_DATE": { $gt: ISODate("2025-08-01T00:00:00-03:00") } }'
  )
})

test('data digitada é lida no fuso pedido, não no da máquina', () => {
  assert.equal(
    valorParaMongo('2025-08-01', 'date', 'UTC'),
    'ISODate("2025-08-01T00:00:00+00:00")'
  )
})

test('texto que não tem forma de data continua texto, em vez de virar data inventada', () => {
  assert.equal(valorParaMongo('ontem', 'date', SP), '"ontem"')
})

test('campo de texto que por acaso guarda datas não é convertido', () => {
  // `string|date` na amostra: há documentos com texto ali, e converter perderia
  // exatamente esses.
  assert.equal(valorParaMongo('2025-08-01', 'string|date', SP), '"2025-08-01"')
})

test('maior E menor no mesmo campo: nenhuma das duas se perde', () => {
  // O filtro dos usuários, do jeito que eles montam. Antes a chave aparecia
  // duas vezes no mesmo objeto, e a segunda apagava a primeira: o `$gt` sumia
  // calado e o filtro trazia tudo desde o começo da coleção até o dia 31.
  const filtro = montarFiltroMongo(
    [
      c('PRODUCT', 'igual', 'MOT'),
      c('PARENT_ID', 'igual', '10000'),
      c('ACTIVATION_DATE', 'maior', '2025-08-01 00:00:00'),
      c('ACTIVATION_DATE', 'menor', '2025-08-31 23:59:59')
    ],
    { PRODUCT: 'string', PARENT_ID: 'number', ACTIVATION_DATE: 'date' },
    SP
  )
  assert.equal(
    filtro,
    '{ "PRODUCT": "MOT", "PARENT_ID": 10000, "ACTIVATION_DATE": { $gt: ISODate("2025-08-01T00:00:00-03:00"), $lt: ISODate("2025-08-31T23:59:59-03:00") } }'
  )
  assert.equal(filtro.match(/"ACTIVATION_DATE"/g)?.length, 1, 'a chave não pode se repetir')
})

test('o mesmo operador duas vezes vai para um $and, que não perde nada', () => {
  const filtro = montarFiltroMongo(
    [c('status', 'diferente', 'CANCELADO'), c('status', 'diferente', 'SUSPENSO')],
    { status: 'string' }
  )
  assert.equal(
    filtro,
    '{ $and: [{ "status": { $ne: "CANCELADO" } }, { "status": { $ne: "SUSPENSO" } }] }'
  )
})

test('valor exato ao lado de operador no mesmo campo também vai para o $and', () => {
  const filtro = montarFiltroMongo(
    [c('nome', 'igual', 'Ana'), c('nome', 'contem', 'an')],
    { nome: 'string' }
  )
  assert.equal(filtro, '{ $and: [{ "nome": "Ana" }, { "nome": { $regex: "an" } }] }')
})

test('o filtro montado é um objeto válido, que o parser do Mongo aceita', async () => {
  // A prévia é o que roda. Um texto bonito que não compila seria o pior caso.
  const { parseMongoCommand } = await import('../main/drivers/mongo-parser.ts')
  const filtro = montarFiltroMongo(
    [c('d', 'maior', '2025-08-01'), c('d', 'menor', '2025-09-01'), c('s', 'diferente', 'a'), c('s', 'diferente', 'b')],
    { d: 'date', s: 'string' },
    SP
  )
  const plano = parseMongoCommand(`db.x.find(${filtro})`)
  const consulta = plano.args[0] as Record<string, any>
  assert.ok(consulta.d.$gt instanceof Date)
  assert.equal(consulta.d.$gt.toISOString(), '2025-08-01T03:00:00.000Z')
  assert.equal(consulta.$and.length, 2)
})
