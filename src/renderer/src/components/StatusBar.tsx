import { DRIVERS } from '@shared/types'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'

const numberFormat = new Intl.NumberFormat('pt-BR')

export function StatusBar(): React.JSX.Element {
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const activeId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const serverVersion = useConnectionStore((s) => s.serverVersion)
  const loadingSchema = useConnectionStore((s) => s.loadingSchema)
  const tab = useTabStore((s) =>
    activeId ? s.tabs.find((t) => t.id === s.activeByConnection[activeId]) : undefined
  )

  const result = tab?.results[tab.activeResultIndex]

  return (
    <footer className="statusbar">
      <div className="statusbar__item">
        <span className={`statusbar__dot ${activeId ? '' : 'statusbar__dot--off'}`} />
        {connection ? connection.name : 'Desconectado'}
      </div>

      {connection && (
        <div className="statusbar__item">
          <span className="badge">{DRIVERS[connection.driver].label}</span>
          {serverVersion && <span>v{serverVersion}</span>}
        </div>
      )}

      {database && <div className="statusbar__item">{database}</div>}

      {loadingSchema && (
        <div className="statusbar__item">
          <span className="spinner" style={{ width: 10, height: 10 }} />
          carregando schema…
        </div>
      )}

      <div className="statusbar__spacer" />

      {tab?.running && (
        <div className="statusbar__item">
          <span className="spinner" style={{ width: 10, height: 10 }} />
          executando…
        </div>
      )}

      {result && !tab?.running && (
        <>
          <div className="statusbar__item">
            {result.affectedRows != null && result.columns.length === 0
              ? `${numberFormat.format(result.affectedRows)} linha(s) afetada(s)`
              : `${numberFormat.format(result.rowCount)} linha(s)`}
          </div>
          <div className="statusbar__item">{numberFormat.format(result.durationMs)} ms</div>
        </>
      )}
    </footer>
  )
}
