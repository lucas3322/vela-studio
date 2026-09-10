/**
 * Leitura de arquivo para importação: parser de CSV em streaming, detecção
 * de delimitador e de cabeçalho, dedução de tipo, e contagem de comandos de
 * um dump SQL.
 *
 * Todas essas regras falham em silêncio quando erradas: o CSV "abre" com uma
 * coluna a menos, ou a prévia mostra cabeçalho onde não tinha — nada estoura,
 * só fica errado. É por isso que moram aqui, fora da UI.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CsvLineParser,
  construirColunas,
  contarComandosSql,
  deduzirTipoColuna,
  detectarCabecalho,
  detectarDelimitador,
  lerLinhasCsv,
  lerPreviaArquivo,
  numerosDeLinhaDosComandos,
  removerBom,
  tipoDeUmValor
} from '../main/import-reader.ts'

function pasta(): string {
  return mkdtempSync(join(tmpdir(), 'vela-import-'))
}

// ── CsvLineParser ────────────────────────────────────────────────────

test('separa campos simples por vírgula', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('a,b,c\n')
  assert.deepEqual(linhas, [['a', 'b', 'c']])
})

test('campo entre aspas pode conter o delimitador', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('"Recife, PE",Ana\n')
  assert.deepEqual(linhas, [['Recife, PE', 'Ana']])
})

test('campo entre aspas pode conter quebra de linha', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('"linha 1\nlinha 2",x\n')
  assert.deepEqual(linhas, [['linha 1\nlinha 2', 'x']])
})

test('aspas duplicadas dentro de campo citado viram uma aspa literal', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('"ele disse ""oi""",y\n')
  assert.deepEqual(linhas, [['ele disse "oi"', 'y']])
})

test('CRLF e LF são reconhecidos como fim de linha', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('a,b\r\nc,d\n')
  assert.deepEqual(linhas, [
    ['a', 'b'],
    ['c', 'd']
  ])
})

test('CR sozinho no fim de um pedaço, seguido de LF no próximo, não gera linha em branco', () => {
  const parser = new CsvLineParser(',')
  const primeiro = parser.push('a,b\r')
  const segundo = parser.push('\nc,d\n')
  assert.deepEqual(primeiro, [['a', 'b']])
  assert.deepEqual(segundo, [['c', 'd']])
})

test('última linha sem quebra final só aparece no flush', () => {
  const parser = new CsvLineParser(',')
  const linhas = parser.push('a,b\nc,d')
  assert.deepEqual(linhas, [['a', 'b']])
  assert.deepEqual(parser.flush(), [['c', 'd']])
})

test('flush não inventa linha quando não sobrou nada', () => {
  const parser = new CsvLineParser(',')
  parser.push('a,b\n')
  assert.deepEqual(parser.flush(), [])
})

test('aspa de fechamento exatamente no fim de um pedaço é resolvida no próximo push', () => {
  // "ab" partido em dois pedaços bem no meio da aspa dupla escapada.
  const parser = new CsvLineParser(',')
  const primeiro = parser.push('"ab""')
  const segundo = parser.push('cd",x\n')
  assert.deepEqual(primeiro, [])
  assert.deepEqual(segundo, [['ab"cd', 'x']])
})

test('aspa isolada no fim de um pedaço, sem escape, fecha o campo', () => {
  const parser = new CsvLineParser(',')
  const primeiro = parser.push('"ab"')
  const segundo = parser.push(',x\n')
  assert.deepEqual(primeiro, [])
  assert.deepEqual(segundo, [['ab', 'x']])
})

test('ponto e vírgula e tabulação funcionam como delimitador', () => {
  assert.deepEqual(new CsvLineParser(';').push('a;b\n'), [['a', 'b']])
  assert.deepEqual(new CsvLineParser('\t').push('a\tb\n'), [['a', 'b']])
})

// ── removerBom ───────────────────────────────────────────────────────

test('remove o BOM apenas quando está no início', () => {
  assert.equal(removerBom('﻿id,nome'), 'id,nome')
  assert.equal(removerBom('id,nome'), 'id,nome')
  assert.equal(removerBom(''), '')
})

// ── detecção de delimitador ─────────────────────────────────────────

test('detecta vírgula quando é o único candidato consistente', () => {
  const amostra = 'id,nome,cidade\n1,Ana,Recife\n2,Bruno,Sao Paulo\n'
  assert.equal(detectarDelimitador(amostra), ',')
})

test('detecta ponto e vírgula mesmo com vírgula dentro dos campos', () => {
  // Endereço em português comum: vírgula faz parte do dado, não separa coluna.
  const amostra = 'id;endereco;cidade\n1;Rua X, 123;Recife\n2;Rua Y, 45;Sao Paulo\n'
  assert.equal(detectarDelimitador(amostra), ';')
})

test('detecta tabulação', () => {
  const amostra = 'id\tnome\n1\tAna\n2\tBruno\n'
  assert.equal(detectarDelimitador(amostra), '\t')
})

test('sem nenhum delimitador reconhecível, cai para vírgula por padrão', () => {
  assert.equal(detectarDelimitador('só uma coluna\nmais uma\n'), ',')
})

// ── dedução de tipo ──────────────────────────────────────────────────

test('tipoDeUmValor reconhece cada categoria', () => {
  assert.equal(tipoDeUmValor(''), 'vazio')
  assert.equal(tipoDeUmValor('   '), 'vazio')
  assert.equal(tipoDeUmValor('42'), 'inteiro')
  assert.equal(tipoDeUmValor('-7'), 'inteiro')
  assert.equal(tipoDeUmValor('3.14'), 'decimal')
  assert.equal(tipoDeUmValor('3,14'), 'decimal')
  assert.equal(tipoDeUmValor('true'), 'booleano')
  assert.equal(tipoDeUmValor('FALSO'), 'booleano')
  assert.equal(tipoDeUmValor('2024-01-15'), 'data')
  assert.equal(tipoDeUmValor('2024-01-15T10:30:00Z'), 'data')
  assert.equal(tipoDeUmValor('15/01/2024'), 'data')
  assert.equal(tipoDeUmValor('Ana Souza'), 'texto')
})

test('deduzirTipoColuna usa o tipo mais frequente na amostra', () => {
  assert.equal(deduzirTipoColuna(['1', '2', '3']), 'inteiro')
  assert.equal(deduzirTipoColuna(['1', '2', 'abc']), 'inteiro')
  assert.equal(deduzirTipoColuna(['', '', '']), 'vazio')
  assert.equal(deduzirTipoColuna(['', '5', '']), 'inteiro')
})

// ── detecção de cabeçalho ────────────────────────────────────────────

test('detecta cabeçalho quando a primeira linha é texto e as demais são numéricas', () => {
  const linhas = [
    ['id', 'nome'],
    ['1', 'Ana'],
    ['2', 'Bruno'],
    ['3', 'Celia']
  ]
  assert.equal(detectarCabecalho(linhas), true)
})

test('não confunde tabela só de texto com cabeçalho', () => {
  const linhas = [
    ['Ana', 'Recife'],
    ['Bruno', 'Sao Paulo'],
    ['Celia', 'Curitiba']
  ]
  assert.equal(detectarCabecalho(linhas), false)
})

test('uma linha só nunca é cabeçalho — não há o que comparar', () => {
  assert.equal(detectarCabecalho([['id', 'nome']]), false)
  assert.equal(detectarCabecalho([]), false)
})

// ── construirColunas ─────────────────────────────────────────────────

test('usa o nome do cabeçalho quando existe', () => {
  const linhas = [
    ['id', 'nome'],
    ['1', 'Ana'],
    ['2', 'Bruno']
  ]
  const colunas = construirColunas(linhas, true)
  assert.deepEqual(colunas.map((c) => c.nome), ['id', 'nome'])
  assert.equal(colunas[0].tipoDeduzido, 'inteiro')
  assert.equal(colunas[1].tipoDeduzido, 'texto')
})

test('sem cabeçalho, os nomes viram "coluna N"', () => {
  const linhas = [
    ['1', 'Ana'],
    ['2', 'Bruno']
  ]
  const colunas = construirColunas(linhas, false)
  assert.deepEqual(colunas.map((c) => c.nome), ['coluna 1', 'coluna 2'])
})

test('exemplos ficam limitados a poucos valores, sem os vazios', () => {
  const linhas = [['nome'], [''], ['Ana'], [''], ['Bruno'], ['Celia'], ['Duda'], ['Elis'], ['Fabio']]
  const colunas = construirColunas(linhas, true)
  assert.ok(colunas[0].exemplos.length <= 5)
  assert.ok(!colunas[0].exemplos.includes(''))
})

// ── contagem de comandos SQL ─────────────────────────────────────────

test('conta comandos, separando INSERT do resto', () => {
  const texto = `
    CREATE TABLE t (id INT);
    INSERT INTO t VALUES (1);
    INSERT INTO t VALUES (2);
    DELETE FROM t WHERE id = 3;
  `
  const { comandos, inserts, outros } = contarComandosSql(texto)
  assert.equal(comandos.length, 4)
  assert.equal(inserts.length, 2)
  assert.equal(outros.length, 2)
})

test('INSERT em minúscula também conta', () => {
  const { inserts } = contarComandosSql('insert into t values (1);')
  assert.equal(inserts.length, 1)
})

// ── numerosDeLinhaDosComandos ────────────────────────────────────────

test('acha a linha de início de cada comando', () => {
  const texto = ['CREATE TABLE t (id INT);', 'INSERT INTO t VALUES (1);', 'INSERT INTO t VALUES (2);'].join(
    '\n'
  )
  const comandos = contarComandosSql(texto).comandos
  const numeros = numerosDeLinhaDosComandos(texto, comandos)
  assert.deepEqual(numeros, [1, 2, 3])
})

test('comandos repetidos não colapsam na mesma linha', () => {
  // Duas linhas com o mesmo texto: a busca precisa avançar, não achar sempre a primeira.
  const texto = ['INSERT INTO t VALUES (1);', 'INSERT INTO t VALUES (1);'].join('\n')
  const comandos = contarComandosSql(texto).comandos
  const numeros = numerosDeLinhaDosComandos(texto, comandos)
  assert.deepEqual(numeros, [1, 2])
})

test('comando que ocupa várias linhas é contado pela linha onde começa', () => {
  const texto = [
    'CREATE TABLE t (',
    '  id INT,',
    '  nome VARCHAR(80)',
    ');',
    'INSERT INTO t VALUES (1, \'Ana\');'
  ].join('\n')
  const comandos = contarComandosSql(texto).comandos
  const numeros = numerosDeLinhaDosComandos(texto, comandos)
  assert.deepEqual(numeros, [1, 5])
})

// ── lerPreviaArquivo (fs) ────────────────────────────────────────────

test('prévia de CSV pequeno não é truncada e detecta cabeçalho', () => {
  const dir = pasta()
  const caminho = join(dir, 'clientes.csv')
  writeFileSync(caminho, 'id,nome,cidade\n1,Ana,Recife\n2,Bruno,Sao Paulo\n', 'utf-8')

  const previa = lerPreviaArquivo(caminho)
  assert.equal(previa.formato, 'csv')
  assert.equal(previa.truncada, false)
  assert.equal(previa.temCabecalho, true)
  assert.equal(previa.delimitador, ',')
  assert.equal(previa.linhas.length, 3) // cabeçalho + 2 linhas de dado
  assert.deepEqual(previa.colunas.map((c) => c.nome), ['id', 'nome', 'cidade'])

  rmSync(dir, { recursive: true, force: true })
})

test('prévia respeita o teto de linhas e avisa que está truncada', () => {
  const dir = pasta()
  const caminho = join(dir, 'muitas.csv')
  const linhas = ['id,nome']
  for (let i = 1; i <= 200; i++) linhas.push(`${i},nome ${i}`)
  writeFileSync(caminho, linhas.join('\n') + '\n', 'utf-8')

  const previa = lerPreviaArquivo(caminho, { linhas: 10 })
  assert.equal(previa.truncada, true)
  assert.equal(previa.linhas.length, 10)

  rmSync(dir, { recursive: true, force: true })
})

test('prévia remove o BOM antes de detectar cabeçalho e delimitador', () => {
  const dir = pasta()
  const caminho = join(dir, 'com-bom.csv')
  writeFileSync(caminho, '﻿id;nome\n1;Ana\n2;Bruno\n', 'utf-8')

  const previa = lerPreviaArquivo(caminho)
  assert.equal(previa.delimitador, ';')
  assert.equal(previa.colunas[0].nome, 'id', 'o BOM não pode grudar no nome da primeira coluna')

  rmSync(dir, { recursive: true, force: true })
})

test('prévia de CSV sem linha final funciona igual', () => {
  const dir = pasta()
  const caminho = join(dir, 'sem-newline-final.csv')
  writeFileSync(caminho, 'id,nome\n1,Ana\n2,Bruno', 'utf-8') // sem \n no fim

  const previa = lerPreviaArquivo(caminho)
  assert.equal(previa.linhas.length, 3)
  assert.deepEqual(previa.linhas[2], ['2', 'Bruno'])

  rmSync(dir, { recursive: true, force: true })
})

test('prévia de .sql conta comandos e separa os que não são INSERT', () => {
  const dir = pasta()
  const caminho = join(dir, 'dump.sql')
  writeFileSync(
    caminho,
    `CREATE TABLE clientes (id INT);\nINSERT INTO clientes VALUES (1);\nINSERT INTO clientes VALUES (2);\n`,
    'utf-8'
  )

  const previa = lerPreviaArquivo(caminho)
  assert.equal(previa.formato, 'sql')
  assert.equal(previa.sql?.comandos, 3)
  assert.equal(previa.sql?.inserts, 2)
  assert.equal(previa.sql?.outros.length, 1)
  assert.equal(previa.truncada, false)

  rmSync(dir, { recursive: true, force: true })
})

test('arquivo .txt é lido como CSV', () => {
  const dir = pasta()
  const caminho = join(dir, 'dados.txt')
  writeFileSync(caminho, 'id,nome\n1,Ana\n', 'utf-8')

  const previa = lerPreviaArquivo(caminho)
  assert.equal(previa.formato, 'csv')

  rmSync(dir, { recursive: true, force: true })
})

test('arquivo inexistente lança erro claro em vez de devolver prévia vazia', () => {
  assert.throws(() => lerPreviaArquivo('/caminho/que/nao/existe/arquivo.csv'), /não encontrado/)
})

// ── lerLinhasCsv (fs, streaming) ─────────────────────────────────────

test('lerLinhasCsv entrega todas as linhas do arquivo, com número físico', async () => {
  const dir = pasta()
  const caminho = join(dir, 'todas.csv')
  writeFileSync(caminho, 'id,nome\n1,Ana\n2,Bruno\n3,Celia\n', 'utf-8')

  const lidas: Array<{ numero: number; campos: string[] }> = []
  for await (const linha of lerLinhasCsv(caminho, { delimitador: ',' })) lidas.push(linha)

  assert.equal(lidas.length, 4) // cabeçalho + 3 linhas
  assert.deepEqual(lidas.map((l) => l.numero), [1, 2, 3, 4])
  assert.deepEqual(lidas[3].campos, ['3', 'Celia'])

  rmSync(dir, { recursive: true, force: true })
})

test('lerLinhasCsv pula linha em branco sem perder a numeração das seguintes', () => {
  return (async () => {
    const dir = pasta()
    const caminho = join(dir, 'com-branco.csv')
    writeFileSync(caminho, 'id,nome\n1,Ana\n\n2,Bruno\n', 'utf-8')

    const lidas: Array<{ numero: number; campos: string[] }> = []
    for await (const linha of lerLinhasCsv(caminho, { delimitador: ',' })) lidas.push(linha)

    // linha 3 (em branco) não aparece, mas a linha 4 mantém seu número real.
    assert.deepEqual(
      lidas.map((l) => l.numero),
      [1, 2, 4]
    )

    rmSync(dir, { recursive: true, force: true })
  })()
})

test('progresso em bytes é crescente e termina no tamanho do arquivo', async () => {
  const dir = pasta()
  const caminho = join(dir, 'progresso.csv')
  const linhas = ['id,nome']
  for (let i = 1; i <= 2000; i++) linhas.push(`${i},nome ${i}`)
  const conteudo = linhas.join('\n') + '\n'
  writeFileSync(caminho, conteudo, 'utf-8')

  const avisos: Array<{ bytesLidos: number; bytesTotais: number }> = []
  for await (const _ of lerLinhasCsv(caminho, { delimitador: ',' }, (bytesLidos, bytesTotais) => {
    avisos.push({ bytesLidos, bytesTotais })
  })) {
    // só percorre
  }

  assert.ok(avisos.length >= 1)
  for (let i = 1; i < avisos.length; i++) {
    assert.ok(avisos[i].bytesLidos >= avisos[i - 1].bytesLidos, 'o progresso não pode andar para trás')
  }
  assert.equal(avisos.at(-1)?.bytesLidos, Buffer.byteLength(conteudo, 'utf-8'))

  rmSync(dir, { recursive: true, force: true })
})
