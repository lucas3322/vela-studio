import { useEffect, useState } from 'react'
import { DRIVERS, type ColumnInfo, type IndexInfo, type RelationInfo } from '@shared/types'
import { useConnectionStore } from '../store/connections'
import { useTabStore, type Tab } from '../store/tabs'
import { ResultsGrid } from './ResultsGrid'
import { ErrorPanel } from './ErrorPanel'
import { IconKey, IconLink } from './Icons'

type Panel = 'dados' | 'colunas' | 'indices' | 'relacoes'

/**
 * Aba de tabela: os dados de um lado, a estrutura do outro.
 * Abrir uma tabela roda um SELECT limitado automaticamente — é o gesto
 * que todo mundo faz manualmente ao clicar numa tabela.
 */
export function TableView({ tab }: { tab: Tab }): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('dados')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [relations, setRelations] = useState<RelationInfo[]>([])
  const [loading, setLoading] = useState(false)

  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const updateTab = useTabStore((s) => s.updateTab)

  const table = tab.table!
  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'

  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    setLoading(true)

    const load = async (): Promise<void> => {
      const queryId = `table_${tab.id}`
      const sql =
        dialect === 'mongodb'
          ? `db.${table}.find({}).limit(500)`
          : `SELECT * FROM ${quote(table, dialect)} LIMIT 500`

      try {
        const [outcome, cols, idx, rels] = await Promise.all([
          window.vela.query.run({ connectionId, sql, database: database ?? undefined, queryId }),
          window.vela.schema.columns(connectionId, table, database ?? undefined).catch(() => []),
          window.vela.schema.indexes(connectionId, table, database ?? undefined).catch(() => []),
          window.vela.schema.relations(connectionId, table, database ?? undefined).catch(() => [])
        ])

        if (cancelled) return
        setColumns(cols)
        setIndexes(idx)
        setRelations(rels)
        updateTab(tab.id, { results: outcome.results, error: outcome.error, activeResultIndex: 0 })
      } catch (error) {
        if (cancelled) return
        updateTab(tab.id, {
          results: [],
          error: { raw: (error as Error).message, friendly: (error as Error).message }
        })
      } finally {
        // Sem o finally, qualquer rejeição deixava a aba presa em "Carregando…".
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [connectionId, database, table, dialect, tab.id, updateTab])

  const result = tab.results[tab.activeResultIndex]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="structure__tabs">
        {(['dados', 'colunas', 'indices', 'relacoes'] as Panel[]).map((item) => (
          <button
            key={item}
            className={`structure__tab ${panel === item ? 'structure__tab--active' : ''}`}
            onClick={() => setPanel(item)}
          >
            {LABELS[item]}
            {item === 'colunas' && columns.length > 0 && ` (${columns.length})`}
            {item === 'indices' && indexes.length > 0 && ` (${indexes.length})`}
            {item === 'relacoes' && relations.length > 0 && ` (${relations.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="results__empty">
          <span className="spinner" />
          Carregando {table}…
        </div>
      )}

      {!loading && panel === 'dados' && (
        <div className="results">
          {tab.error && <ErrorPanel error={tab.error} />}
          {result && <ResultsGrid result={result} />}
        </div>
      )}

      {!loading && panel === 'colunas' && (
        <div className="structure">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Nome</th>
                <th>Tipo</th>
                <th>Nulo</th>
                <th>Padrão</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name}>
                  <td>
                    {column.isPrimaryKey ? (
                      <IconKey size={13} style={{ color: 'var(--warning)' }} />
                    ) : column.isForeignKey ? (
                      <IconLink size={13} style={{ color: 'var(--info)' }} />
                    ) : null}
                  </td>
                  <td style={{ fontWeight: 500 }}>{column.name}</td>
                  <td className="mono">{column.type}</td>
                  <td className="mono">{column.nullable ? 'sim' : 'não'}</td>
                  <td className="mono">{column.defaultValue ?? '—'}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>
                    {column.comment ??
                      (column.frequency != null ? `em ${column.frequency}% dos documentos` : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && panel === 'indices' && (
        <div className="structure">
          {indexes.length === 0 ? (
            <div className="tree-empty">Esta tabela não tem índices além da chave primária.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Colunas</th>
                  <th>Único</th>
                  <th>Primário</th>
                </tr>
              </thead>
              <tbody>
                {indexes.map((index) => (
                  <tr key={index.name}>
                    <td style={{ fontWeight: 500 }}>{index.name}</td>
                    <td className="mono">{index.columns.join(', ')}</td>
                    <td>{index.unique ? 'sim' : 'não'}</td>
                    <td>{index.primary ? 'sim' : 'não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && panel === 'relacoes' && (
        <div className="structure">
          {relations.length === 0 ? (
            <div className="tree-empty">
              Nenhuma chave estrangeira declarada.
              {dialect === 'mongodb' && (
                <>
                  <br />
                  O MongoDB não declara relações — elas ficam na aplicação.
                </>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coluna</th>
                  <th>Referencia</th>
                  <th>Ao excluir</th>
                  <th>Ao atualizar</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((relation) => (
                  <tr key={relation.constraintName + relation.column}>
                    <td className="mono">{relation.column}</td>
                    <td className="mono">
                      {relation.referencedTable}.{relation.referencedColumn}
                    </td>
                    <td>{relation.onDelete ?? '—'}</td>
                    <td>{relation.onUpdate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

const LABELS: Record<Panel, string> = {
  dados: 'Dados',
  colunas: 'Colunas',
  indices: 'Índices',
  relacoes: 'Relações'
}

/** Cada banco cita identificador de um jeito; errar isso quebra nomes com espaço. */
function quote(name: string, dialect: string): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}
