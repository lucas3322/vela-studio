import { useMemo, useState } from 'react'
import { DRIVERS } from '@shared/types'
import { MONGO_DOCS, REDIS_DOCS, SQL_DOCS, type SqlDoc } from '../editor/sql-docs'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { IconClose, IconSearch, IconWarning } from './Icons'

const CATEGORY_LABELS: Record<SqlDoc['category'], string> = {
  clausula: 'Cláusulas',
  juncao: 'Junções',
  operador: 'Operadores',
  funcao: 'Funções',
  modificador: 'Modificadores',
  ddl: 'Estrutura (DDL)',
  dml: 'Dados (DML)'
}

/**
 * O mesmo conteúdo do hover, mas navegável.
 * Serve para quem quer estudar em vez de tropeçar na explicação por acaso.
 */
export function CheatsheetModal(): React.JSX.Element {
  const closeModal = useAppStore((s) => s.closeModal)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const dialeto = connection ? DRIVERS[connection.driver].dialect : undefined
  const isMongo = dialeto === 'mongodb'
  const isRedis = dialeto === 'redis'

  const [filter, setFilter] = useState('')
  const [source, setSource] = useState<'sql' | 'mongo' | 'redis'>(
    isRedis ? 'redis' : isMongo ? 'mongo' : 'sql'
  )

  const entries = useMemo(() => {
    const dictionary = source === 'mongo' ? MONGO_DOCS : source === 'redis' ? REDIS_DOCS : SQL_DOCS
    const term = filter.trim().toLowerCase()
    const list = Object.entries(dictionary).filter(
      ([term_, doc]) =>
        !term ||
        term_.toLowerCase().includes(term) ||
        doc.summary.toLowerCase().includes(term) ||
        doc.detail.toLowerCase().includes(term)
    )

    const grouped = new Map<SqlDoc['category'], Array<[string, SqlDoc]>>()
    for (const entry of list) {
      const group = grouped.get(entry[1].category) ?? []
      group.push(entry)
      grouped.set(entry[1].category, group)
    }
    return [...grouped.entries()]
  }, [filter, source])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Guia rápido</div>
            <div className="modal__subtitle">
              {source === 'redis'
                ? 'Todo comando explicado em português, com exemplo e a pegadinha de cada um. Vários comandos no editor se separam por ";", um por statement.'
                : 'Todo comando explicado em português, com exemplo e a pegadinha de cada um.'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div className="segmented">
              <button data-active={source === 'sql'} onClick={() => setSource('sql')}>
                SQL
              </button>
              <button data-active={source === 'mongo'} onClick={() => setSource('mongo')}>
                MongoDB
              </button>
              <button data-active={source === 'redis'} onClick={() => setSource('redis')}>
                Redis
              </button>
            </div>
            <button className="icon-btn" onClick={closeModal}>
              <IconClose />
            </button>
          </div>
        </div>

        <div style={{ padding: 'var(--space-3) var(--space-5) 0', position: 'relative' }}>
          <IconSearch
            size={13}
            style={{
              position: 'absolute',
              left: 'calc(var(--space-5) + 10px)',
              top: 'calc(var(--space-3) + 10px)',
              color: 'var(--text-tertiary)'
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Buscar comando ou conceito"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className="modal__body" style={{ gap: 0 }}>
          {entries.map(([category, docs]) => (
            <div key={category}>
              <div className="recipe-category" style={{ paddingLeft: 0 }}>
                {CATEGORY_LABELS[category]}
              </div>
              {docs.map(([term, doc]) => (
                <div key={term} className="cheatsheet__entry">
                  <div className="cheatsheet__term">{term}</div>
                  <div className="cheatsheet__summary">{doc.summary}</div>
                  <div
                    className="cheatsheet__summary"
                    style={{ color: 'var(--text-primary)', marginTop: 4 }}
                  >
                    {stripMarkdown(doc.detail)}
                  </div>
                  {doc.example && <pre className="cheatsheet__example">{doc.example}</pre>}
                  {doc.gotcha && (
                    <div className="cheatsheet__gotcha">
                      <IconWarning size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>{stripMarkdown(doc.gotcha)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="tree-empty">Nada encontrado para "{filter}".</div>
          )}
        </div>
      </div>
    </div>
  )
}

/** As docs usam markdown para o hover do Monaco; aqui exibimos texto puro. */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '')
}
