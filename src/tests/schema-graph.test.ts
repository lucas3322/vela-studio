/**
 * O grafo do schema e a inferência de ligações não declaradas.
 *
 * A parte delicada é a inferência: ela produz afirmações sobre o banco que o
 * banco não fez. Errar aqui é o pior tipo de erro deste projeto — a pessoa
 * acredita numa ligação que não existe e escreve o JOIN errado. Por isso os
 * testes cobrem tanto o que ela deve encontrar quanto o que ela **não pode**
 * inventar.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ColumnInfo, SchemaRelation, TableInfo } from '../shared/types.ts'
import {
  componentes,
  entidadeReferenciada,
  mesmaEntidade,
  montarGrafo,
  vizinhanca
} from '../renderer/src/model/schema-graph.ts'

const col = (name: string, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name,
  type: 'int',
  nullable: true,
  isPrimaryKey: false,
  ...extra
})

const pk = (name = 'id'): ColumnInfo => col(name, { isPrimaryKey: true, nullable: false })

const tabela = (name: string): TableInfo => ({ name, type: 'table' })

const fk = (
  table: string,
  column: string,
  referencedTable: string,
  referencedColumn = 'id'
): SchemaRelation => ({
  table,
  column,
  referencedTable,
  referencedColumn,
  constraintName: `fk_${table}_${column}`
})

// ── nomes ────────────────────────────────────────────────────────────

test('reconhece a entidade que o nome da coluna sugere', () => {
  assert.equal(entidadeReferenciada('cliente_id'), 'cliente')
  assert.equal(entidadeReferenciada('id_cliente'), 'cliente')
  assert.equal(entidadeReferenciada('clienteId'), 'cliente')
  assert.equal(entidadeReferenciada('cliente_codigo'), 'cliente')
  assert.equal(entidadeReferenciada('fk_cliente'), 'cliente')
})

test('uma coluna `id` sozinha não referencia ninguém', () => {
  // É a chave da própria tabela. Tratá-la como referência ligaria toda tabela
  // a alguma outra chamada "id".
  assert.equal(entidadeReferenciada('id'), undefined)
  assert.equal(entidadeReferenciada('ID'), undefined)
  assert.equal(entidadeReferenciada('_id'), undefined)
  assert.equal(entidadeReferenciada('nome'), undefined)
  assert.equal(entidadeReferenciada('valor_total'), undefined)
})

test('singular e plural do português casam', () => {
  assert.ok(mesmaEntidade('cliente', 'clientes'))
  assert.ok(mesmaEntidade('ligacao', 'ligacoes'))
  assert.ok(mesmaEntidade('ligação', 'ligações'))
  assert.ok(mesmaEntidade('homem', 'homens'))
  assert.ok(mesmaEntidade('papel', 'papeis'))
  assert.ok(mesmaEntidade('contrato', 'contratos'))
})

test('prefixo de convenção não atrapalha o casamento', () => {
  assert.ok(mesmaEntidade('cliente', 'tb_clientes'))
  assert.ok(mesmaEntidade('produto', 'tbl_produto'))
})

test('entidades diferentes não casam', () => {
  assert.equal(mesmaEntidade('cliente', 'produto'), false)
  assert.equal(mesmaEntidade('pedido', 'pedagio'), false)
})

// ── grafo a partir de FK declarada ──────────────────────────────────

test('FK declarada vira aresta com a constraint junto', () => {
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes')],
    columns: { pedidos: [pk(), col('cliente_id')], clientes: [pk()] },
    relations: [fk('pedidos', 'cliente_id', 'clientes')],
    inferir: false
  })

  assert.equal(grafo.arestas.length, 1)
  assert.equal(grafo.arestas[0].origem, 'declarada')
  assert.equal(grafo.arestas[0].de, 'pedidos')
  assert.equal(grafo.arestas[0].para, 'clientes')
  assert.equal(grafo.arestas[0].constraint, 'fk_pedidos_cliente_id')
})

test('FK apontando para tabela fora do schema é descartada', () => {
  // Desenhar o destino faria o diagrama inventar uma tabela que a barra
  // lateral não lista — e a pessoa iria procurá-la.
  const grafo = montarGrafo({
    tables: [tabela('pedidos')],
    columns: { pedidos: [pk(), col('cliente_id')] },
    relations: [fk('pedidos', 'cliente_id', 'clientes_de_outro_schema')],
    inferir: false
  })
  assert.equal(grafo.arestas.length, 0)
})

test('sem inferir, nada além do declarado aparece', () => {
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes')],
    columns: { pedidos: [pk(), col('cliente_id')], clientes: [pk()] },
    relations: [],
    inferir: false
  })
  assert.equal(grafo.arestas.length, 0)
})

// ── inferência ───────────────────────────────────────────────────────

test('deduz a ligação que o banco não declarou, marcada como provável', () => {
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes')],
    columns: { pedidos: [pk(), col('cliente_id')], clientes: [pk()] },
    relations: [],
    inferir: true
  })

  assert.equal(grafo.arestas.length, 1)
  const a = grafo.arestas[0]
  assert.equal(a.origem, 'provavel')
  assert.equal(a.de, 'pedidos')
  assert.equal(a.para, 'clientes')
  assert.equal(a.colunaAlvo, 'id')
  assert.ok(a.motivo?.includes('não declara'), 'a aresta provável precisa dizer o porquê')
  assert.equal(a.constraint, undefined, 'palpite não pode inventar nome de constraint')
})

test('o que já é declarado não vira palpite duplicado', () => {
  // Sem isso, toda FK bem nomeada apareceria duas vezes: uma sólida e uma
  // tracejada, sugerindo duas ligações onde há uma.
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes')],
    columns: { pedidos: [pk(), col('cliente_id')], clientes: [pk()] },
    relations: [fk('pedidos', 'cliente_id', 'clientes')],
    inferir: true
  })
  assert.equal(grafo.arestas.length, 1)
  assert.equal(grafo.arestas[0].origem, 'declarada')
})

test('a chave primária com o nome da própria tabela não é auto-referência', () => {
  // `clientes.cliente_id` sendo PK é convenção de nomenclatura, não ligação.
  const grafo = montarGrafo({
    tables: [tabela('clientes')],
    columns: { clientes: [pk('cliente_id'), col('nome', { type: 'varchar' })] },
    relations: [],
    inferir: true
  })
  assert.equal(grafo.arestas.length, 0)
})

test('auto-referência real é mantida', () => {
  // `categorias.categoria_pai_id` não casa com "categorias" pelo nome, então
  // o caso que importa é o explícito: coluna não-PK apontando para a própria.
  const grafo = montarGrafo({
    tables: [tabela('categorias')],
    columns: { categorias: [pk(), col('categoria_id')] },
    relations: [],
    inferir: true
  })
  assert.equal(grafo.arestas.length, 1)
  assert.equal(grafo.arestas[0].de, 'categorias')
  assert.equal(grafo.arestas[0].para, 'categorias')
})

test('não deduz ligação para tabela sem chave alguma', () => {
  // Sem coluna de destino, a linha não diria nada — apontaria para o nada.
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes')],
    columns: { pedidos: [pk(), col('cliente_id')], clientes: [col('nome')] },
    relations: [],
    inferir: true
  })
  assert.equal(grafo.arestas.length, 0)
})

test('coluna que parece referência mas não tem tabela correspondente é ignorada', () => {
  const grafo = montarGrafo({
    tables: [tabela('pedidos')],
    columns: { pedidos: [pk(), col('transportadora_id')] },
    relations: [],
    inferir: true
  })
  assert.equal(grafo.arestas.length, 0)
})

test('o grau conta as duas pontas', () => {
  const grafo = montarGrafo({
    tables: [tabela('pedidos'), tabela('clientes'), tabela('itens')],
    columns: {
      pedidos: [pk(), col('cliente_id')],
      clientes: [pk()],
      itens: [pk(), col('pedido_id')]
    },
    relations: [fk('pedidos', 'cliente_id', 'clientes'), fk('itens', 'pedido_id', 'pedidos')],
    inferir: false
  })
  assert.equal(grafo.nos.get('pedidos')?.grau, 2)
  assert.equal(grafo.nos.get('clientes')?.grau, 1)
  assert.equal(grafo.nos.get('itens')?.grau, 1)
})

// ── vizinhança e ilhas ──────────────────────────────────────────────

const cadeia = montarGrafo({
  tables: ['a', 'b', 'c', 'd', 'sozinha'].map(tabela),
  columns: {
    a: [pk()],
    b: [pk(), col('a_id')],
    c: [pk(), col('b_id')],
    d: [pk(), col('c_id')],
    sozinha: [pk()]
  },
  relations: [fk('b', 'a_id', 'a'), fk('c', 'b_id', 'b'), fk('d', 'c_id', 'c')],
  inferir: false
})

test('vizinhança respeita a profundidade pedida', () => {
  assert.deepEqual([...vizinhanca(cadeia, 'a', 1)].sort(), ['a', 'b'])
  assert.deepEqual([...vizinhanca(cadeia, 'a', 2)].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...vizinhanca(cadeia, 'b', 1)].sort(), ['a', 'b', 'c'])
})

test('a vizinhança anda contra a seta também', () => {
  // Quem referencia a tabela importa tanto quanto quem ela referencia — achar
  // só um dos lados esconde metade das dependências.
  assert.ok(vizinhanca(cadeia, 'd', 1).has('c'))
})

test('ilhas separam módulos de tabelas soltas, maior primeiro', () => {
  const grupos = componentes(cadeia)
  assert.equal(grupos.length, 2)
  assert.equal(grupos[0].length, 4)
  assert.deepEqual(grupos[1], ['sozinha'])
})

// ── o caso que motivou tudo ─────────────────────────────────────────

test('um schema sem nenhuma FK declarada ainda produz diagrama', () => {
  // CRM legado: integridade na aplicação, zero FK no banco. Sem inferência a
  // tela abriria vazia, afirmando que o schema não tem ligação nenhuma.
  const semFk = {
    tables: ['clientes', 'contratos', 'boletos'].map(tabela),
    columns: {
      clientes: [pk(), col('nome', { type: 'varchar' })],
      contratos: [pk(), col('cliente_id')],
      boletos: [pk(), col('contrato_id'), col('cliente_id')]
    },
    relations: [] as SchemaRelation[]
  }

  assert.equal(montarGrafo({ ...semFk, inferir: false }).arestas.length, 0)

  const comPalpite = montarGrafo({ ...semFk, inferir: true })
  assert.equal(comPalpite.arestas.length, 3)
  assert.ok(
    comPalpite.arestas.every((a) => a.origem === 'provavel'),
    'nada aqui pode ser apresentado como declarado'
  )
})
