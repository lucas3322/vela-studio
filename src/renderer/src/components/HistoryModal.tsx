import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { IconCheck, IconClose, IconSearch, IconWarning } from './Icons'

const numberFormat = new Intl.NumberFormat('pt-BR')

export function HistoryModal(): React.JSX.Element {
  const closeModal = useAppStore((s) => s.closeModal)
  const notify = useAppStore((s) => s.notify)
  const activeConnectionId = useConnectionStore((s) => s.activeId)
  const activeDatabase = useConnectionStore((s) => s.activeDatabase)
  const openQueryTab = useTabStore((s) => s.openQueryTab)

  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [filter, setFilter] = useState('')
  const [onlyCurrent, setOnlyCurrent] = useState(true)

  useEffect(() => {
    void window.vela.history
      .list(onlyCurrent && activeConnectionId ? activeConnectionId : undefined)
      .then(setEntries)
  }, [onlyCurrent, activeConnectionId])

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) => entry.sql.toLowerCase().includes(term))
  }, [entries, filter])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Histórico</div>
            <div className="modal__subtitle">
              As últimas 500 queries executadas. Clique para abrir em uma aba nova.
            </div>
          </div>
          <button className="icon-btn" onClick={closeModal}>
            <IconClose />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            alignItems: 'center',
            padding: 'var(--space-3) var(--space-5) 0'
          }}
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <IconSearch
              size={13}
              style={{
                position: 'absolute',
                left: 10,
                top: 10,
                color: 'var(--text-tertiary)'
              }}
            />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Buscar no histórico"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          </div>
          <label className="checkbox" style={{ whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={onlyCurrent}
              onChange={(e) => setOnlyCurrent(e.target.checked)}
            />
            Só desta conexão
          </label>
        </div>

        <div className="modal__body" style={{ gap: 'var(--space-1)' }}>
          {filtered.map((entry) => (
            <button
              key={entry.id}
              className="history-item"
              onClick={() => {
                if (!activeConnectionId) return
                openQueryTab({
                  connectionId: activeConnectionId,
                  database: activeDatabase,
                  sql: entry.sql
                })
                closeModal()
              }}
              disabled={!activeConnectionId}
              title={activeConnectionId ? 'Abrir em uma aba nova' : 'Conecte-se a um banco primeiro'}
            >
              <div className="history-item__sql">{entry.sql}</div>
              <div className="history-item__meta">
                {entry.ok ? (
                  <IconCheck size={12} style={{ color: 'var(--success)' }} />
                ) : (
                  <IconWarning size={12} style={{ color: 'var(--danger)' }} />
                )}
                <span>{formatWhen(entry.executedAt)}</span>
                <span>·</span>
                <span>{entry.connectionName}</span>
                {entry.rowCount != null && (
                  <>
                    <span>·</span>
                    <span>{numberFormat.format(entry.rowCount)} linhas</span>
                  </>
                )}
                {entry.durationMs != null && (
                  <>
                    <span>·</span>
                    <span>{numberFormat.format(entry.durationMs)} ms</span>
                  </>
                )}
              </div>
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="tree-empty">
              {filter ? `Nada encontrado para "${filter}".` : 'Nenhuma query executada ainda.'}
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button
            className="btn btn--danger modal__footer-left"
            onClick={async () => {
              await window.vela.history.clear()
              setEntries([])
              notify('Histórico apagado.', 'info')
            }}
          >
            Limpar histórico
          </button>
          <button className="btn btn--secondary" onClick={closeModal}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Datas relativas: "há 5 min" diz mais que um timestamp em um histórico. */
function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `há ${days} d`
  return new Date(timestamp).toLocaleDateString('pt-BR')
}
