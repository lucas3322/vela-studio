/**
 * Regra pura da importação de arquivo para tabela: casamento de coluna por
 * nome, compatibilidade de tipo, a regra da chave auto-incremento e a
 * detecção de obrigatória sem mapeamento.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ColumnInfo, ColunaDoArquivo } from '../shared/types.ts'
import {
  aplicarRegraDeChaveAutomatica,
  casarColunas,
  colunaAutomatica,
  colunasObrigatoriasSemMapeamento,
  compatibilidade,
  normalizarNome
} from '../renderer/src/editor/importacao.ts'

function colArquivo(nome: string, indice: number): ColunaDoArquivo {
  return { nome, indice, tipoDeduzido: 'texto', exemplos: [] }
}

function coluna(patch: Partial<ColumnInfo> & { name: string }): ColumnInfo {
  return {
    type: 'varchar(255)',
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    ...patch
  }
}

test('normalizarNome ignora caixa, acento e o formato snake/camel', () => {
  assert.equal(normalizarNome('criado_em'), normalizarNome('CriadoEm'))
  assert.equal(normalizarNome('Endereço'), normalizarNome('endereco'))
  assert.equal(normalizarNome('Primeiro Nome'), normalizarNome('primeiro_nome'))
})

test('normalizarNome não confunde nomes de fato diferentes', () => {
  assert.notEqual(normalizarNome('nome'), normalizarNome('sobrenome'))
})

test('casarColunas casa por nome tolerante e ignora coluna sem par', () => {
  const arquivo = [colArquivo('Nome', 0), colArquivo('E-mail', 1), colArquivo('coluna extra', 2)]
  const tabela = [coluna({ name: 'nome' }), coluna({ name: 'email' })]

  const mapeamento = casarColunas(arquivo, tabela)

  assert.deepEqual(mapeamento, [
    { origem: 0, destino: 'nome' },
    { origem: 1, destino: 'email' },
    { origem: 2, destino: null }
  ])
})

test('casarColunas nunca aponta duas colunas do arquivo para o mesmo destino', () => {
  const arquivo = [colArquivo('nome', 0), colArquivo('Nome', 1)]
  const tabela = [coluna({ name: 'nome' })]

  const mapeamento = casarColunas(arquivo, tabela)

  assert.equal(mapeamento[0].destino, 'nome')
  assert.equal(mapeamento[1].destino, null)
})

test('colunaAutomatica reconhece auto_increment, identity e generated, sem se importar com a caixa', () => {
  assert.equal(colunaAutomatica(coluna({ name: 'id', extra: 'auto_increment' })), true)
  assert.equal(colunaAutomatica(coluna({ name: 'id', extra: 'AUTO_INCREMENT' })), true)
  assert.equal(colunaAutomatica(coluna({ name: 'id', extra: 'GENERATED ALWAYS AS IDENTITY' })), true)
  assert.equal(colunaAutomatica(coluna({ name: 'nome', extra: null })), false)
})

test('aplicarRegraDeChaveAutomatica ignora a chave por padrão', () => {
  const tabela = [coluna({ name: 'id', extra: 'auto_increment', isPrimaryKey: true }), coluna({ name: 'nome' })]
  const arquivo = [colArquivo('id', 0), colArquivo('nome', 1)]
  const base = casarColunas(arquivo, tabela)

  const ajustado = aplicarRegraDeChaveAutomatica(base, arquivo, tabela, false)

  assert.equal(ajustado.find((m) => m.origem === 0)?.destino, null)
  assert.equal(ajustado.find((m) => m.origem === 1)?.destino, 'nome')
})

test('aplicarRegraDeChaveAutomatica religa a coluna do arquivo quando usarIdsDoArquivo é true', () => {
  const tabela = [coluna({ name: 'id', extra: 'auto_increment', isPrimaryKey: true }), coluna({ name: 'nome' })]
  const arquivo = [colArquivo('id', 0), colArquivo('nome', 1)]
  const base = casarColunas(arquivo, tabela)
  const ignorado = aplicarRegraDeChaveAutomatica(base, arquivo, tabela, false)

  const religado = aplicarRegraDeChaveAutomatica(ignorado, arquivo, tabela, true)

  assert.equal(religado.find((m) => m.origem === 0)?.destino, 'id')
})

test('colunasObrigatoriasSemMapeamento cobra NOT NULL sem default e sem mapeamento', () => {
  const tabela = [
    coluna({ name: 'id', extra: 'auto_increment', isPrimaryKey: true, nullable: false }),
    coluna({ name: 'nome', nullable: false }),
    coluna({ name: 'criado_em', nullable: false, defaultValue: 'now()' }),
    coluna({ name: 'apelido', nullable: true })
  ]
  const mapeamento = [{ origem: 0, destino: null }] // só a coluna "apelido" nunca foi citada

  const obrigatorias = colunasObrigatoriasSemMapeamento(tabela, mapeamento)

  assert.deepEqual(
    obrigatorias.map((c) => c.name),
    ['nome']
  )
})

test('colunasObrigatoriasSemMapeamento não cobra coluna já mapeada', () => {
  const tabela = [coluna({ name: 'nome', nullable: false })]
  const mapeamento = [{ origem: 0, destino: 'nome' }]

  assert.deepEqual(colunasObrigatoriasSemMapeamento(tabela, mapeamento), [])
})

test('compatibilidade: tipo igual é compatível', () => {
  assert.equal(compatibilidade('inteiro', 'bigint').veredito, 'compativel')
  assert.equal(compatibilidade('texto', 'varchar(255)').veredito, 'compativel')
  assert.equal(compatibilidade('data', 'timestamp').veredito, 'compativel')
  assert.equal(compatibilidade('booleano', 'boolean').veredito, 'compativel')
})

test('compatibilidade: inteiro cabe em decimal sem perda', () => {
  assert.equal(compatibilidade('inteiro', 'numeric(10,2)').veredito, 'compativel')
})

test('compatibilidade: decimal em inteiro é convertível, com aviso de perda', () => {
  const r = compatibilidade('decimal', 'int')
  assert.equal(r.veredito, 'convertivel')
  assert.match(r.motivo, /decimais/)
})

test('compatibilidade: texto em inteiro é incompatível', () => {
  assert.equal(compatibilidade('texto', 'int').veredito, 'incompativel')
})

test('compatibilidade: tinyint(1) do MySQL é lido como booleano, não como inteiro', () => {
  assert.equal(compatibilidade('booleano', 'tinyint(1)').veredito, 'compativel')
})

test('compatibilidade: coluna vazia na amostra é sempre compatível', () => {
  assert.equal(compatibilidade('vazio', 'int').veredito, 'compativel')
  assert.equal(compatibilidade('vazio', 'date').veredito, 'compativel')
})

test('compatibilidade: tipo de coluna não reconhecido vira convertível, não trava', () => {
  const r = compatibilidade('inteiro', 'geography(point)')
  assert.equal(r.veredito, 'convertivel')
})

test('compatibilidade: "point" dentro de geography não é lido como inteiro por acidente', () => {
  // Casar por substring faria `/int/` bater dentro de "point" — a categoria
  // certa aqui é "desconhecido", não "inteiro".
  assert.equal(compatibilidade('texto', 'geography(point,4326)').veredito, 'convertivel')
})

test('compatibilidade: "character varying" do Postgres (format_type) é lido como texto', () => {
  assert.equal(compatibilidade('texto', 'character varying(255)').veredito, 'compativel')
  assert.equal(compatibilidade('texto', 'character varying').veredito, 'compativel')
})

test('compatibilidade: "timestamp without time zone" do Postgres é lido como data', () => {
  assert.equal(compatibilidade('data', 'timestamp without time zone').veredito, 'compativel')
})
