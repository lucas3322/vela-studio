import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore, type Tab } from '../store/tabs'
import { montarGrafo, type Aresta, type Grafo } from '../model/schema-graph'
import { caminho, layoutFoco, layoutMapa, type Caixa, type Medidor } from '../model/layout'
import { IconKey, IconLink, IconRefresh, IconTable, IconWarning } from './Icons'

/**
 * Diagrama de modelagem: tabelas e as ligações entre elas.
 *
 * ## As duas decisões que moldam a tela
 *
 * **Foco em vez de mapa inteiro, por padrão.** Um CRM com 211 tabelas
 * desenhado de uma vez é um novelo — tecnicamente completo e praticamente
 * ilegível. A vista útil é uma tabela no centro com quem ela toca. O mapa
 * completo continua a um clique, para reconhecer os módulos do sistema.
 *
 * **Palpite nunca se veste de fato.** Ligação declarada no banco é linha
 * cheia; ligação deduzida do nome da coluna é tracejada e mais clara. A
 * diferença é de traço e peso, não de cor: assim ela sobrevive a quem não
 * distingue cores e à impressão em preto e branco.
 */

/** Altura de cada linha dentro do cartão, e do cabeçalho. */
const LINHA = 19
const CABECALHO = 28
const MAX_LINHAS = 6

interface LinhaCartao {
  texto: string
  papel: 'pk' | 'fk' | 'resto'
}

/** O que cabe dentro de um cartão: a chave e as colunas que ligam. */
function linhasDoCartao(grafo: Grafo, nome: string): LinhaCartao[] {
  const no = grafo.nos.get(nome)
  if (!no) return []

  const ligantes = new Set(grafo.arestas.filter((a) => a.de === nome).map((a) => a.coluna))
  const linhas: LinhaCartao[] = []

  for (const c of no.colunas) {
    if (c.isPrimaryKey) linhas.push({ texto: c.name, papel: 'pk' })
  }
  for (const c of no.colunas) {
    if (!c.isPrimaryKey && ligantes.has(c.name)) linhas.push({ texto: c.name, papel: 'fk' })
  }
  return linhas
}

/**
 * Largura de um texto, estimada.
 *
 * Medir de verdade exigiria montar o SVG antes de saber onde as coisas vão —
 * e a medida ainda sairia errada na primeira pintura. A estimativa erra para
 * mais alguns pixels, o que só afasta os cartões: erro seguro.
 */
function larguraTexto(texto: string, px: number): number {
  return texto.length * px * 0.56
}

export function ModelDiagram({ tab }: { tab: Tab }): React.JSX.Element {
  const schema = useConnectionStore((s) => s.currentSchema())
  const loadRelations = useConnectionStore((s) => s.loadRelations)
  const loadingRelations = useConnectionStore((s) => s.loadingRelations)
  const conexao = useConnectionStore((s) => s.activeConnection())
  const preferencia = useAppStore((s) => s.inferirRelacoes)
  const setInferir = useAppStore((s) => s.setInferirRelacoes)
  const updateTab = useTabStore((s) => s.updateTab)
  const openTableTab = useTabStore((s) => s.openTableTab)

  const [vista, setVista] = useState({ x: 0, y: 0, k: 1 })
  const [arestaAtiva, setArestaAtiva] = useState<Aresta | null>(null)
  const palco = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  useEffect(() => {
    void loadRelations()
  }, [loadRelations, tab.database])

  const relations = schema?.relations
  const profundidade = tab.modelDepth ?? 1

  // Quantas FKs o banco realmente declara decide o padrão da inferência: é o
  // que evita tanto o diagrama vazio quanto o mapa correto poluído de palpite.
  const declaradas = relations?.length ?? 0
  const inferir = preferencia === 'auto' ? declaradas === 0 : preferencia === 'sim'

  const grafo = useMemo<Grafo>(() => {
    if (!schema) return { nos: new Map(), arestas: [] }
    return montarGrafo({
      tables: schema.tables,
      columns: schema.columns,
      relations: relations ?? [],
      inferir
    })
  }, [schema, relations, inferir])

  const medir = useMemo<Medidor>(() => {
    return (nome) => {
      const linhas = linhasDoCartao(grafo, nome).slice(0, MAX_LINHAS)
      const larguraNome = larguraTexto(nome, 13) + 40
      const larguraLinhas = Math.max(0, ...linhas.map((l) => larguraTexto(l.texto, 12) + 44))
      return {
        w: Math.min(300, Math.max(170, larguraNome, larguraLinhas)),
        h: CABECALHO + linhas.length * LINHA + 10
      }
    }
  }, [grafo])

  const diagrama = useMemo(() => {
    if (grafo.nos.size === 0) return null
    if (tab.modelFocus && grafo.nos.has(tab.modelFocus)) {
      return layoutFoco(grafo, tab.modelFocus, profundidade, medir)
    }
    return layoutMapa(grafo, medir)
  }, [grafo, tab.modelFocus, profundidade, medir])

  const ajustar = (): void => {
    const caixa = palco.current?.getBoundingClientRect()
    if (!caixa || !diagrama || diagrama.largura === 0) return
    const k = Math.min(caixa.width / diagrama.largura, caixa.height / diagrama.altura, 1)
    setVista({
      k,
      x: (caixa.width - diagrama.largura * k) / 2,
      y: (caixa.height - diagrama.altura * k) / 2
    })
  }

  // Enquadra a cada mudança de recorte. `useLayoutEffect` porque a leitura do
  // tamanho precisa acontecer depois do DOM montado e antes da pintura — com
  // `useEffect` o diagrama aparecia por um quadro no canto errado.
  useLayoutEffect(ajustar, [diagrama])

  if (!schema) {
    return <Aviso icone="carregando" titulo="Lendo a estrutura do banco…" />
  }

  if (relations === undefined && loadingRelations) {
    return <Aviso icone="carregando" titulo="Procurando as ligações entre as tabelas…" />
  }

  // Chave do Redis não referencia outra chave, declarada ou deduzida: as
  // pseudo-tabelas sempre têm as mesmas 3 colunas (key, value, ttl), então
  // não há nome de campo que aponte para outra pseudo-tabela. Em vez de abrir
  // um diagrama vazio com os controles de dedução e profundidade — que aqui
  // não teriam efeito nenhum —, a aba diz de saída que não há o que desenhar.
  if (conexao?.driver === 'redis') {
    return (
      <div className="modelo">
        <div className="modelo__barra">
          <span className="modelo__titulo">
            <IconLink size={13} />
            Mapa do banco
          </span>
        </div>
        <div className="modelo__nota">
          <IconWarning size={14} />
          <span>
            O Redis <strong>não tem relação entre chaves</strong> — cada chave é independente,
            sem integridade referencial com nenhuma outra.
          </span>
        </div>
        <div className="modelo__palco">
          <Aviso
            icone="vazio"
            titulo="Nada para modelar"
            detalhe="Abra uma pseudo-tabela e use o padrão de chave para explorar os dados."
          />
        </div>
      </div>
    )
  }

  const focoValido = tab.modelFocus && grafo.nos.has(tab.modelFocus)
  const provaveis = grafo.arestas.filter((a) => a.origem === 'provavel').length

  return (
    <div className="modelo">
      <div className="modelo__barra">
        <span className="modelo__titulo">
          {focoValido ? (
            <>
              <IconTable size={13} />
              {tab.modelFocus}
            </>
          ) : (
            <>
              <IconLink size={13} />
              Mapa do banco
            </>
          )}
        </span>

        {focoValido && (
          <span className="segmented" role="group" aria-label="Distância mostrada">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                data-active={profundidade === n}
                onClick={() => updateTab(tab.id, { modelDepth: n })}
                title={`Mostrar tabelas a até ${n} ${n === 1 ? 'salto' : 'saltos'} de distância`}
              >
                {n}
              </button>
            ))}
          </span>
        )}

        <span className="modelo__espaco" />

        <label className="checkbox modelo__palpite" title="Ligações deduzidas pelo nome das colunas">
          <input
            type="checkbox"
            checked={inferir}
            onChange={(e) => setInferir(e.target.checked ? 'sim' : 'nao')}
          />
          <span>
            Deduzir não declaradas
            {inferir && provaveis > 0 ? ` · ${provaveis}` : ''}
          </span>
        </label>

        {focoValido && (
          <button className="btn btn--secondary btn--sm" onClick={() => updateTab(tab.id, { modelFocus: undefined, title: 'Modelagem' })}>
            Ver tudo
          </button>
        )}
        <button className="icon-btn" onClick={ajustar} title="Enquadrar o diagrama">
          <IconRefresh size={13} />
        </button>
      </div>

      {/*
        Duas mensagens diferentes de propósito. "Este banco não declara FK" é
        verdade no Mongo, mas dá a entender que faltou alguém declarar — quando
        o motor simplesmente não tem o conceito. Dizer o mesmo nos dois casos
        ensinaria errado sobre o banco que a pessoa está usando.
      */}
      {declaradas === 0 && (
        <div className="modelo__nota">
          <IconWarning size={14} />
          <span>
            {conexao?.driver === 'mongodb' ? (
              <>
                O MongoDB <strong>não declara ligação entre coleções</strong> — o vínculo vive na
                aplicação.
              </>
            ) : (
              <>
                Este banco <strong>não declara nenhuma chave estrangeira</strong>.
              </>
            )}
            {inferir
              ? ' As ligações abaixo foram deduzidas pelo nome dos campos; confira antes de confiar.'
              : ' Ligue a dedução acima para ver ligações prováveis.'}
          </span>
        </div>
      )}

      <div
        className="modelo__palco"
        ref={palco}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          arrasto.current = { x: e.clientX, y: e.clientY, vx: vista.x, vy: vista.y }
        }}
        onMouseMove={(e) => {
          const a = arrasto.current
          if (!a) return
          setVista((v) => ({ ...v, x: a.vx + (e.clientX - a.x), y: a.vy + (e.clientY - a.y) }))
        }}
        onMouseUp={() => (arrasto.current = null)}
        onMouseLeave={() => (arrasto.current = null)}
        onWheel={(e) => {
          // ⌘/Ctrl + roda amplia no ponto do cursor; roda sozinha desloca,
          // que é o que a mão espera dentro de uma IDE.
          if (e.metaKey || e.ctrlKey) {
            const caixa = palco.current?.getBoundingClientRect()
            if (!caixa) return
            const px = e.clientX - caixa.left
            const py = e.clientY - caixa.top
            setVista((v) => {
              const k = Math.min(2.5, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
              return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k }
            })
          } else {
            setVista((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
          }
        }}
      >
        {!diagrama || diagrama.caixas.length === 0 ? (
          <Aviso
            icone="vazio"
            titulo="Nada para desenhar"
            detalhe="Este banco não tem tabelas carregadas."
          />
        ) : (
          <svg
            className="modelo__svg"
            width={diagrama.largura * vista.k}
            height={diagrama.altura * vista.k}
            viewBox={`0 0 ${diagrama.largura} ${diagrama.altura}`}
            style={{ transform: `translate(${vista.x}px, ${vista.y}px)` }}
          >
            <defs>
              <marker id="seta-firme" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1 L7 4 L0 7 z" className="modelo__ponta" />
              </marker>
              <marker id="seta-palpite" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 1 L7 4 L0 7 z" className="modelo__ponta modelo__ponta--palpite" />
              </marker>
            </defs>

            {diagrama.arestas.map((a, i) => {
              const de = diagrama.caixas.find((c) => c.nome === a.de)
              const para = diagrama.caixas.find((c) => c.nome === a.para)
              if (!de || !para || de === para) return null
              const ativa = arestaAtiva === a
              return (
                <path
                  key={`${a.de}.${a.coluna}->${a.para}.${i}`}
                  d={caminho(de, para)}
                  className={`modelo__linha modelo__linha--${a.origem} ${ativa ? 'modelo__linha--ativa' : ''}`}
                  markerEnd={`url(#${a.origem === 'declarada' ? 'seta-firme' : 'seta-palpite'})`}
                  onMouseEnter={() => setArestaAtiva(a)}
                  onMouseLeave={() => setArestaAtiva(null)}
                >
                  <title>{descreverAresta(a)}</title>
                </path>
              )
            })}

            {diagrama.caixas.map((caixa) => (
              <Cartao
                key={caixa.nome}
                caixa={caixa}
                grafo={grafo}
                focado={caixa.nome === tab.modelFocus}
                aoFocar={() => updateTab(tab.id, { modelFocus: caixa.nome, title: caixa.nome })}
                aoAbrir={() =>
                  openTableTab({
                    connectionId: tab.connectionId,
                    database: tab.database,
                    table: caixa.nome
                  })
                }
              />
            ))}
          </svg>
        )}

      </div>

      <div className="modelo__legenda">
        <span>
          <svg width="26" height="8" aria-hidden>
            <line x1="1" y1="4" x2="25" y2="4" className="modelo__linha modelo__linha--declarada" />
          </svg>
          declarada no banco
        </span>
        <span>
          <svg width="26" height="8" aria-hidden>
            <line x1="1" y1="4" x2="25" y2="4" className="modelo__linha modelo__linha--provavel" />
          </svg>
          provável, não declarada
        </span>
        <span className="modelo__dica">clique numa tabela para centrar · duplo clique abre os dados</span>
      </div>
    </div>
  )
}

function descreverAresta(a: Aresta): string {
  const base = `${a.de}.${a.coluna} → ${a.para}.${a.colunaAlvo}`
  if (a.origem === 'provavel') return `${base}\n\n${a.motivo ?? ''}`
  const regras = [a.onDelete && `ON DELETE ${a.onDelete}`, a.onUpdate && `ON UPDATE ${a.onUpdate}`]
    .filter(Boolean)
    .join(' · ')
  return `${base}\n${a.constraint ?? ''}${regras ? `\n${regras}` : ''}`
}

function Cartao({
  caixa,
  grafo,
  focado,
  aoFocar,
  aoAbrir
}: {
  caixa: Caixa
  grafo: Grafo
  focado: boolean
  aoFocar: () => void
  aoAbrir: () => void
}): React.JSX.Element {
  const todas = linhasDoCartao(grafo, caixa.nome)
  const linhas = todas.slice(0, MAX_LINHAS)
  const sobrando = todas.length - linhas.length

  return (
    <g
      className={`modelo__cartao ${focado ? 'modelo__cartao--foco' : ''}`}
      transform={`translate(${caixa.x} ${caixa.y})`}
      onClick={aoFocar}
      onDoubleClick={aoAbrir}
    >
      <title>{`${caixa.nome} — clique para centrar, duplo clique para abrir os dados`}</title>
      <rect className="modelo__caixa" width={caixa.w} height={caixa.h} rx={7} />
      <rect className="modelo__cabecalho" width={caixa.w} height={CABECALHO} rx={7} />
      <text className="modelo__nome" x={10} y={CABECALHO / 2 + 4}>
        {caixa.nome}
      </text>

      {linhas.map((linha, i) => (
        <g key={linha.texto} transform={`translate(0 ${CABECALHO + i * LINHA})`}>
          <g transform="translate(10 4)" className={`modelo__marca modelo__marca--${linha.papel}`}>
            {linha.papel === 'pk' ? <IconKey size={11} /> : <IconLink size={11} />}
          </g>
          <text className={`modelo__coluna modelo__coluna--${linha.papel}`} x={28} y={LINHA / 2 + 8}>
            {linha.texto}
          </text>
        </g>
      ))}

      {sobrando > 0 && (
        <text className="modelo__resto" x={10} y={CABECALHO + linhas.length * LINHA + 2}>
          +{sobrando}
        </text>
      )}
    </g>
  )
}

function Aviso({
  icone,
  titulo,
  detalhe
}: {
  icone: 'carregando' | 'vazio'
  titulo: string
  detalhe?: string
}): React.JSX.Element {
  return (
    <div className="results__empty">
      {icone === 'carregando' ? <span className="spinner" /> : <IconLink size={26} />}
      <div>
        {titulo}
        {detalhe && (
          <>
            <br />
            {detalhe}
          </>
        )}
      </div>
    </div>
  )
}
