import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { montarGrafo } from '../model/schema-graph'
import { IconLink, IconSearch, IconWarning } from './Icons'

/**
 * A aba "Modelagem" da barra lateral.
 *
 * O diagrama vive no painel principal, onde há espaço. Aqui fica o **índice**:
 * quais tabelas participam do modelo e quão conectada cada uma é. Num banco de
 * 211 tabelas isso responde a primeira pergunta de quem chega — "por onde eu
 * começo a olhar?" — antes mesmo de desenhar qualquer coisa.
 *
 * A ordem é por número de ligações, não alfabética: as tabelas mais ligadas
 * são o miolo do sistema. Uma lista A–Z começaria por `acessos_log`.
 */
export function SchemaModelList(): React.JSX.Element {
  const schema = useConnectionStore((s) => s.currentSchema())
  const loadRelations = useConnectionStore((s) => s.loadRelations)
  const loadingRelations = useConnectionStore((s) => s.loadingRelations)
  const activeId = useConnectionStore((s) => s.activeId)
  const activeDatabase = useConnectionStore((s) => s.activeDatabase)
  const conexao = useConnectionStore((s) => s.activeConnection())
  const preferencia = useAppStore((s) => s.inferirRelacoes)
  const openModelTab = useTabStore((s) => s.openModelTab)

  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    void loadRelations()
  }, [loadRelations, activeId, activeDatabase])

  const relations = schema?.relations
  const declaradas = relations?.length ?? 0
  const inferir = preferencia === 'auto' ? declaradas === 0 : preferencia === 'sim'

  const grafo = useMemo(() => {
    if (!schema) return null
    return montarGrafo({
      tables: schema.tables,
      columns: schema.columns,
      relations: relations ?? [],
      inferir
    })
  }, [schema, relations, inferir])

  const listadas = useMemo(() => {
    if (!grafo) return []
    const busca = filtro.trim().toLowerCase()
    return [...grafo.nos.values()]
      .filter((n) => n.grau > 0)
      .filter((n) => !busca || n.nome.toLowerCase().includes(busca))
      .sort((a, b) => b.grau - a.grau || a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [grafo, filtro])

  const abrir = (foco?: string): void => {
    if (!activeId) return
    openModelTab({ connectionId: activeId, database: activeDatabase, focus: foco })
  }

  if (!schema || (relations === undefined && loadingRelations)) {
    return (
      <div className="tree-empty">
        <span className="spinner" />
        Procurando as ligações…
      </div>
    )
  }

  // Chave do Redis não referencia outra chave — não existe FK declarada nem
  // um nome de campo plausível para deduzir ligação, porque as 3 colunas das
  // pseudo-tabelas (key, value, ttl) são sempre as mesmas em todas elas. Rodar
  // a inferência aqui só produziria ruído, então a aba nem chega a montar o
  // grafo: diz de saída que não há o que modelar, em vez de abrir vazia.
  if (conexao?.driver === 'redis') {
    return (
      <div className="modelo-lista__nota">
        <IconWarning size={13} />
        <span>O Redis não tem relação entre chaves — não há o que modelar aqui.</span>
      </div>
    )
  }

  const semLigacao = grafo ? grafo.arestas.length === 0 : true

  return (
    <>
      <div className="sidebar__search">
        <IconSearch size={13} />
        <input
          className="input"
          placeholder="Filtrar tabelas do modelo"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      </div>

      <div className="modelo-lista__topo">
        <button className="btn btn--primary btn--sm" onClick={() => abrir()}>
          <IconLink size={13} />
          Ver o mapa do banco
        </button>
      </div>

      {declaradas === 0 && (
        <div className="modelo-lista__nota">
          <IconWarning size={13} />
          <span>
            {conexao?.driver === 'mongodb'
              ? 'O MongoDB não declara ligação entre coleções.'
              : 'Nenhuma chave estrangeira declarada neste banco.'}
            {inferir
              ? ' As ligações abaixo foram deduzidas pelo nome das colunas.'
              : ' Ligue a dedução no diagrama para ver ligações prováveis.'}
          </span>
        </div>
      )}

      {semLigacao ? (
        <div className="tree-empty">
          Nenhuma ligação encontrada entre as tabelas.
        </div>
      ) : (
        <>
          <div className="sidebar__section">
            Tabelas ligadas · {listadas.length}
          </div>
          <div className="modelo-lista">
            {listadas.map((no) => (
              <button
                key={no.nome}
                className="modelo-lista__item"
                onClick={() => abrir(no.nome)}
                title={`Centrar o diagrama em ${no.nome}`}
              >
                <span className="modelo-lista__nome">{no.nome}</span>
                <span className="modelo-lista__grau">
                  {no.grau} {no.grau === 1 ? 'ligação' : 'ligações'}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
