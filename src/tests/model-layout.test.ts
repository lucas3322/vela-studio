/**
 * Posicionamento do diagrama de modelagem.
 *
 * Duas propriedades sustentam a tela e nenhuma delas aparece no typecheck:
 *
 * 1. **Cartões não se sobrepõem.** A falha acontece justamente nas tabelas com
 *    mais ligações — as mais importantes do schema.
 * 2. **Mesma entrada, mesma posição.** Se o arranjo mudasse a cada abertura, a
 *    memória visual que a pessoa constrói ("pedidos fica à direita") não
 *    valeria nada.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ColumnInfo, SchemaRelation, TableInfo } from '../shared/types.ts'
import { montarGrafo } from '../renderer/src/model/schema-graph.ts'
import {
  caminho,
  layoutFoco,
  layoutMapa,
  pontoNaBorda,
  type Caixa,
  type Medidor
} from '../renderer/src/model/layout.ts'

const pk: ColumnInfo = { name: 'id', type: 'int', nullable: false, isPrimaryKey: true }
const col = (name: string): ColumnInfo => ({ name, type: 'int', nullable: true, isPrimaryKey: false })
const tabela = (name: string): TableInfo => ({ name, type: 'table' })

/** Cartão de tamanho realista: largura pelo nome, altura pelo anel. */
const medir: Medidor = (nome, anel) => ({
  w: Math.max(160, nome.length * 8 + 40),
  h: anel === 0 ? 130 : 70
})

/** Estrela: um centro com `n` satélites, que é o caso que mais aperta o anel. */
function estrela(n: number): ReturnType<typeof montarGrafo> {
  const satelites = Array.from({ length: n }, (_, i) => `satelite_${String(i).padStart(2, '0')}`)
  const columns: Record<string, ColumnInfo[]> = { centro: [pk] }
  const relations: SchemaRelation[] = []
  for (const s of satelites) {
    columns[s] = [pk, col('centro_id')]
    relations.push({
      table: s,
      column: 'centro_id',
      referencedTable: 'centro',
      referencedColumn: 'id',
      constraintName: `fk_${s}`
    })
  }
  return montarGrafo({
    tables: [tabela('centro'), ...satelites.map(tabela)],
    columns,
    relations,
    inferir: false
  })
}

function seSobrepoe(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function paresSobrepostos(caixas: Caixa[]): string[] {
  const achados: string[] = []
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      if (seSobrepoe(caixas[i], caixas[j])) achados.push(`${caixas[i].nome} × ${caixas[j].nome}`)
    }
  }
  return achados
}

// ── não se sobrepõem ────────────────────────────────────────────────

test('cartões não se sobrepõem, de 1 a 40 vizinhas', () => {
  // O anel precisa crescer com a quantidade. Com raio fixo, a partir de umas
  // 8 vizinhas os cartões empilham uns sobre os outros.
  for (const n of [1, 2, 3, 5, 8, 12, 20, 40]) {
    const { caixas } = layoutFoco(estrela(n), 'centro', 1, medir)
    assert.equal(caixas.length, n + 1, `${n} vizinhas`)
    assert.deepEqual(paresSobrepostos(caixas), [], `com ${n} vizinhas`)
  }
})

test('cartões não se sobrepõem com dois anéis', () => {
  const grafo = montarGrafo({
    tables: ['raiz', ...Array.from({ length: 6 }, (_, i) => `meio_${i}`), ...Array.from({ length: 18 }, (_, i) => `folha_${i}`)].map(tabela),
    columns: Object.fromEntries([
      ['raiz', [pk]],
      ...Array.from({ length: 6 }, (_, i) => [`meio_${i}`, [pk, col('raiz_id')]] as const),
      ...Array.from({ length: 18 }, (_, i) => [`folha_${i}`, [pk, col('meio_id')]] as const)
    ]),
    relations: [
      ...Array.from({ length: 6 }, (_, i) => ({
        table: `meio_${i}`,
        column: 'raiz_id',
        referencedTable: 'raiz',
        referencedColumn: 'id',
        constraintName: `fk_m${i}`
      })),
      ...Array.from({ length: 18 }, (_, i) => ({
        table: `folha_${i}`,
        column: 'meio_id',
        referencedTable: `meio_${i % 6}`,
        referencedColumn: 'id',
        constraintName: `fk_f${i}`
      }))
    ],
    inferir: false
  })

  const { caixas } = layoutFoco(grafo, 'raiz', 2, medir)
  assert.equal(caixas.length, 25)
  assert.deepEqual(paresSobrepostos(caixas), [])
})

test('nenhum cartão do mapa completo se sobrepõe', () => {
  const grafo = montarGrafo({
    tables: [
      ...['clientes', 'contratos', 'boletos'].map(tabela),
      ...['produtos', 'estoque'].map(tabela),
      ...['log_a', 'log_b', 'log_c'].map(tabela)
    ],
    columns: {
      clientes: [pk],
      contratos: [pk, col('cliente_id')],
      boletos: [pk, col('contrato_id')],
      produtos: [pk],
      estoque: [pk, col('produto_id')],
      log_a: [pk],
      log_b: [pk],
      log_c: [pk]
    },
    relations: [],
    inferir: true
  })

  const { caixas } = layoutMapa(grafo, medir)
  assert.equal(caixas.length, 8)
  assert.deepEqual(paresSobrepostos(caixas), [])
})

// ── determinismo ────────────────────────────────────────────────────

test('a mesma entrada produz exatamente as mesmas coordenadas', () => {
  const a = layoutFoco(estrela(9), 'centro', 1, medir)
  const b = layoutFoco(estrela(9), 'centro', 1, medir)
  assert.deepEqual(a.caixas, b.caixas)
})

test('a ordem em que o banco devolveu as tabelas não muda o desenho', () => {
  // Sem ordenação estável, reabrir a aba depois de o banco responder noutra
  // ordem embaralharia o diagrama inteiro.
  const base = {
    columns: {
      centro: [pk],
      alfa: [pk, col('centro_id')],
      beta: [pk, col('centro_id')],
      gama: [pk, col('centro_id')]
    },
    relations: ['alfa', 'beta', 'gama'].map((t) => ({
      table: t,
      column: 'centro_id',
      referencedTable: 'centro',
      referencedColumn: 'id',
      constraintName: `fk_${t}`
    })),
    inferir: false
  }

  const umaOrdem = layoutFoco(
    montarGrafo({ ...base, tables: ['centro', 'alfa', 'beta', 'gama'].map(tabela) }),
    'centro',
    1,
    medir
  )
  const outraOrdem = layoutFoco(
    montarGrafo({ ...base, tables: ['gama', 'centro', 'beta', 'alfa'].map(tabela) }),
    'centro',
    1,
    medir
  )

  const chave = (c: Caixa): string => `${c.nome}@${Math.round(c.x)},${Math.round(c.y)}`
  assert.deepEqual(umaOrdem.caixas.map(chave).sort(), outraOrdem.caixas.map(chave).sort())
})

// ── moldura e ligações ──────────────────────────────────────────────

test('tudo cabe dentro da moldura declarada, sem coordenada negativa', () => {
  const { caixas, largura, altura } = layoutFoco(estrela(14), 'centro', 1, medir)
  for (const c of caixas) {
    assert.ok(c.x >= 0 && c.y >= 0, `${c.nome} fora do quadrante: ${c.x},${c.y}`)
    assert.ok(c.x + c.w <= largura, `${c.nome} passa da largura`)
    assert.ok(c.y + c.h <= altura, `${c.nome} passa da altura`)
  }
})

test('a linha toca a borda do cartão, não o centro', () => {
  // Ligando centro a centro, a ponta da seta fica escondida sob o cartão e o
  // sentido da relação — quem aponta para quem — desaparece.
  const caixa: Caixa = { nome: 'a', x: 0, y: 0, w: 100, h: 60, anel: 0 }
  const p = pontoNaBorda(caixa, { x: 500, y: 30 })
  assert.equal(p.x, 100, 'deveria encostar na borda direita')
  assert.equal(p.y, 30)

  const cima = pontoNaBorda(caixa, { x: 50, y: -500 })
  assert.equal(cima.y, 0, 'deveria encostar na borda de cima')
})

test('a curva sai de um cartão e chega no outro', () => {
  const a: Caixa = { nome: 'a', x: 0, y: 0, w: 100, h: 60, anel: 0 }
  const b: Caixa = { nome: 'b', x: 400, y: 0, w: 100, h: 60, anel: 1 }
  const d = caminho(a, b)
  assert.match(d, /^M [\d.]+ [\d.]+ Q [-\d.]+ [-\d.]+ [\d.]+ [\d.]+$/)

  // M x1 y1 Q cx cy x2 y2 — o destino é o penúltimo par, não o ponto de controle.
  const partes = d.split(' ')
  assert.ok(Number(partes[1]) <= 100, 'começa na borda do primeiro')
  assert.ok(Number(partes[6]) >= 400, 'termina na borda do segundo')
})

// ── casos de borda ──────────────────────────────────────────────────

test('tabela sem nenhuma ligação vira um diagrama de um cartão só', () => {
  const grafo = montarGrafo({
    tables: [tabela('sozinha')],
    columns: { sozinha: [pk] },
    relations: [],
    inferir: true
  })
  const d = layoutFoco(grafo, 'sozinha', 2, medir)
  assert.equal(d.caixas.length, 1)
  assert.ok(d.largura > 0 && d.altura > 0)
})

test('grafo vazio não quebra o mapa', () => {
  const d = layoutMapa({ nos: new Map(), arestas: [] }, medir)
  assert.deepEqual(d.caixas, [])
  assert.equal(d.largura, 0)
})

test('o diagrama de foco só carrega as arestas que ele desenha', () => {
  // Uma aresta cujas pontas ficaram fora do recorte viraria linha para lugar
  // nenhum — ou pior, uma linha ligando dois cartões errados.
  const grafo = montarGrafo({
    tables: ['a', 'b', 'c'].map(tabela),
    columns: { a: [pk], b: [pk, col('a_id')], c: [pk, col('b_id')] },
    relations: [
      { table: 'b', column: 'a_id', referencedTable: 'a', referencedColumn: 'id', constraintName: 'f1' },
      { table: 'c', column: 'b_id', referencedTable: 'b', referencedColumn: 'id', constraintName: 'f2' }
    ],
    inferir: false
  })

  const foco = layoutFoco(grafo, 'a', 1, medir)
  const nomes = new Set(foco.caixas.map((c) => c.nome))
  assert.deepEqual([...nomes].sort(), ['a', 'b'])
  for (const aresta of foco.arestas) {
    assert.ok(nomes.has(aresta.de) && nomes.has(aresta.para), `aresta órfã: ${aresta.de}→${aresta.para}`)
  }
})
