import type { Aresta, Grafo } from './schema-graph'
import { componentes, vizinhanca } from './schema-graph.ts'

/**
 * Posiciona as tabelas do diagrama.
 *
 * ## Por que não é simulação física
 *
 * Layout por força é o padrão em ferramenta de grafo, e é a escolha errada
 * aqui: o resultado muda a cada abertura. A pessoa memoriza que "pedidos fica
 * embaixo à esquerda", fecha a aba, reabre e está em outro lugar. Num
 * diagrama que serve para entender um sistema, a estabilidade vale mais do
 * que a elegância do arranjo.
 *
 * Então tudo aqui é determinístico: mesma entrada, mesmas coordenadas, sempre.
 * Nada de `Math.random`, nada de iteração até convergir.
 *
 * ## As duas vistas
 *
 * - **Foco** — uma tabela no centro, vizinhas em anéis. É a vista útil num
 *   schema de 200 tabelas, onde o mapa inteiro é um novelo.
 * - **Mapa** — tudo, agrupado por ilha de tabelas conectadas. Serve para
 *   reconhecer os módulos do sistema e as tabelas órfãs.
 */

export interface Caixa {
  nome: string
  x: number
  y: number
  w: number
  h: number
  /** Distância em saltos até o centro. `0` é a própria tabela focada. */
  anel: number
}

export interface Diagrama {
  caixas: Caixa[]
  arestas: Aresta[]
  largura: number
  altura: number
}

/** Quem chama decide o tamanho do cartão — ele depende do que será desenhado. */
export type Medidor = (nome: string, anel: number) => { w: number; h: number }

const ESPACO = 28

/**
 * Raio de um anel: grande o bastante para os cartões não se tocarem.
 *
 * A conta é o perímetro necessário dividido por 2π. Sem isso, um anel com 20
 * vizinhas empilhava cartão sobre cartão — e o diagrama ficava ilegível
 * exatamente nas tabelas mais importantes, que são as que têm mais ligações.
 */
function raioDoAnel(larguras: number[], raioMinimo: number): number {
  const perimetro = larguras.reduce((s, w) => s + w + ESPACO, 0)
  return Math.max(raioMinimo, perimetro / (2 * Math.PI))
}

/** Ordena por nome: sem isso a posição dependeria da ordem que o banco devolveu. */
function estavel(nomes: string[]): string[] {
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Vista de foco: `centro` no meio, vizinhas em anéis concêntricos.
 */
export function layoutFoco(
  grafo: Grafo,
  centro: string,
  profundidade: number,
  medir: Medidor
): Diagrama {
  const dentro = vizinhanca(grafo, centro, profundidade)

  // Distância de cada tabela até o centro, para saber em que anel ela cai.
  const anelDe = new Map<string, number>([[centro, 0]])
  let fronteira = [centro]
  for (let d = 1; d <= profundidade; d++) {
    const proxima: string[] = []
    for (const a of grafo.arestas) {
      for (const [origem, destino] of [
        [a.de, a.para],
        [a.para, a.de]
      ]) {
        if (fronteira.includes(origem) && dentro.has(destino) && !anelDe.has(destino)) {
          anelDe.set(destino, d)
          proxima.push(destino)
        }
      }
    }
    if (!proxima.length) break
    fronteira = proxima
  }

  const caixas: Caixa[] = []
  const medidaCentro = medir(centro, 0)
  caixas.push({ nome: centro, x: 0, y: 0, ...medidaCentro, anel: 0 })

  let raioAnterior = Math.max(medidaCentro.w, medidaCentro.h) / 2

  for (let anel = 1; anel <= profundidade; anel++) {
    const nomes = estavel([...anelDe.entries()].filter(([, d]) => d === anel).map(([n]) => n))
    if (!nomes.length) continue

    const medidas = nomes.map((n) => medir(n, anel))
    const raio = raioDoAnel(
      medidas.map((m) => m.w),
      raioAnterior + Math.max(...medidas.map((m) => m.h)) + ESPACO * 2
    )

    nomes.forEach((nome, i) => {
      // Começa em -90° para a primeira vizinha cair acima do centro: é o
      // ponto que o olho procura primeiro.
      const angulo = (i / nomes.length) * Math.PI * 2 - Math.PI / 2
      const m = medidas[i]
      caixas.push({
        nome,
        x: Math.cos(angulo) * raio - m.w / 2,
        y: Math.sin(angulo) * raio - m.h / 2,
        w: m.w,
        h: m.h,
        anel
      })
    })

    raioAnterior = raio + Math.max(...medidas.map((m) => m.h)) / 2
  }

  // Centraliza o cartão do meio e normaliza tudo para coordenadas positivas.
  const centroCaixa = caixas[0]
  centroCaixa.x = -centroCaixa.w / 2
  centroCaixa.y = -centroCaixa.h / 2

  return normalizar(
    caixas,
    grafo.arestas.filter((a) => dentro.has(a.de) && dentro.has(a.para))
  )
}

/**
 * Mapa completo: cada ilha de tabelas conectadas vira um bloco, e os blocos
 * são empacotados em linhas.
 *
 * Tabelas sem nenhuma ligação viram uma grade compacta no fim — elas existem
 * e precisam aparecer, mas não podem ocupar o mesmo espaço de um módulo.
 */
export function layoutMapa(grafo: Grafo, medir: Medidor, larguraAlvo = 2400): Diagrama {
  const grupos = componentes(grafo)
  const ilhas = grupos.filter((g) => g.length > 1)
  const soltas = grupos.filter((g) => g.length === 1).flat()

  const blocos: Caixa[][] = []

  for (const ilha of ilhas) {
    // O eixo do bloco é a tabela mais conectada da ilha — quase sempre a
    // entidade central daquele módulo.
    const eixo = estavel(ilha).reduce((melhor, nome) =>
      (grafo.nos.get(nome)?.grau ?? 0) > (grafo.nos.get(melhor)?.grau ?? 0) ? nome : melhor
    )
    const subGrafo: Grafo = {
      nos: new Map([...grafo.nos].filter(([n]) => ilha.includes(n))),
      arestas: grafo.arestas.filter((a) => ilha.includes(a.de) && ilha.includes(a.para))
    }
    const profundidade = Math.min(3, Math.max(1, Math.ceil(Math.log2(ilha.length + 1))))
    blocos.push(layoutFoco(subGrafo, eixo, profundidade, medir).caixas)
  }

  if (soltas.length) {
    const medidas = estavel(soltas).map((n) => ({ nome: n, ...medir(n, 1) }))
    const colunas = Math.max(1, Math.floor(Math.sqrt(medidas.length * 1.6)))
    const largura = Math.max(...medidas.map((m) => m.w)) + ESPACO
    const altura = Math.max(...medidas.map((m) => m.h)) + ESPACO
    blocos.push(
      medidas.map((m, i) => ({
        nome: m.nome,
        x: (i % colunas) * largura,
        y: Math.floor(i / colunas) * altura,
        w: m.w,
        h: m.h,
        anel: 1
      }))
    )
  }

  // Empacota os blocos em linhas, quebrando quando a linha excede a largura.
  const caixas: Caixa[] = []
  let x = 0
  let y = 0
  let alturaDaLinha = 0
  const MARGEM = ESPACO * 3

  for (const bloco of blocos) {
    const w = Math.max(...bloco.map((c) => c.x + c.w))
    const h = Math.max(...bloco.map((c) => c.y + c.h))
    if (x > 0 && x + w > larguraAlvo) {
      x = 0
      y += alturaDaLinha + MARGEM
      alturaDaLinha = 0
    }
    for (const c of bloco) caixas.push({ ...c, x: c.x + x, y: c.y + y })
    x += w + MARGEM
    alturaDaLinha = Math.max(alturaDaLinha, h)
  }

  return normalizar(caixas, grafo.arestas)
}

/** Desloca tudo para o primeiro quadrante e mede o total. */
function normalizar(caixas: Caixa[], arestas: Aresta[]): Diagrama {
  if (!caixas.length) return { caixas, arestas, largura: 0, altura: 0 }

  const margem = ESPACO * 2
  const minX = Math.min(...caixas.map((c) => c.x))
  const minY = Math.min(...caixas.map((c) => c.y))
  const movidas = caixas.map((c) => ({ ...c, x: c.x - minX + margem, y: c.y - minY + margem }))

  return {
    caixas: movidas,
    arestas,
    largura: Math.max(...movidas.map((c) => c.x + c.w)) + margem,
    altura: Math.max(...movidas.map((c) => c.y + c.h)) + margem
  }
}

// ── ligação entre dois cartões ──────────────────────────────────────

export interface Ponto {
  x: number
  y: number
}

/**
 * Onde a linha toca a borda do cartão, na direção de um alvo.
 *
 * Ligar centro a centro faria a seta desaparecer sob o cartão e a ponta ficar
 * escondida — o sentido da relação some, que é justamente o que o diagrama
 * precisa mostrar.
 */
export function pontoNaBorda(caixa: Caixa, alvo: Ponto): Ponto {
  const cx = caixa.x + caixa.w / 2
  const cy = caixa.y + caixa.h / 2
  const dx = alvo.x - cx
  const dy = alvo.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }

  // Escala o vetor até encostar no primeiro lado que ele cruza.
  const escalaX = dx === 0 ? Infinity : caixa.w / 2 / Math.abs(dx)
  const escalaY = dy === 0 ? Infinity : caixa.h / 2 / Math.abs(dy)
  const escala = Math.min(escalaX, escalaY)
  return { x: cx + dx * escala, y: cy + dy * escala }
}

export function centroDe(caixa: Caixa): Ponto {
  return { x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 }
}

/**
 * Curva suave entre dois cartões.
 *
 * Reta cruzando o diagrama inteiro fica indistinguível de outra reta no mesmo
 * feixe. Uma curva leve dá a cada ligação um traçado próprio, e o olho
 * consegue seguir uma delas até o fim.
 */
export function caminho(origem: Caixa, destino: Caixa): string {
  const a = pontoNaBorda(origem, centroDe(destino))
  const b = pontoNaBorda(destino, centroDe(origem))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const curvatura = 0.18
  const mx = (a.x + b.x) / 2 - dy * curvatura
  const my = (a.y + b.y) / 2 + dx * curvatura
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`
}
