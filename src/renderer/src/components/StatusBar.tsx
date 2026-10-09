import { useEffect, useState } from 'react'
import { DRIVERS } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'

const numberFormat = new Intl.NumberFormat('pt-BR')
const segundosFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

/**
 * Tempo decorrido da execução, contando ao vivo.
 *
 * "executando…" parado diz que algo está acontecendo, mas não diz se é
 * normal: uma query de 2 s e uma travada há 40 s mostravam a mesma tela. O
 * relógio correndo responde "vale esperar ou cancelo?" sem a pessoa abrir
 * nada. Começa a contar quando o componente monta, que é o instante em que a
 * aba entra em execução.
 */
function Cronometro(): React.JSX.Element {
  const [inicio] = useState(() => performance.now())
  const [agora, setAgora] = useState(inicio)

  useEffect(() => {
    const id = setInterval(() => setAgora(performance.now()), 100)
    return () => clearInterval(id)
  }, [])

  return <span className="statusbar__cronometro">{segundosFormat.format((agora - inicio) / 1000)} s</span>
}

export function StatusBar(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const activeId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const serverVersion = useConnectionStore((s) => s.serverVersion)
  const fuso = useConnectionStore((s) => s.sessionTimeZone)
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

      {/*
        O fuso da sessão fica à vista porque ele decide como uma data é lida e
        mostrada — e "a hora está errada" é o tipo de bug que ninguém liga a
        uma configuração invisível. É o fuso efetivo: se o MySQL recusou o nome
        e caiu para `-03:00`, é `-03:00` que aparece.
      */}
      {fuso && (
        <div
          className="statusbar__item"
          title="Fuso em que as datas desta conexão são mostradas e lidas. Muda em Editar conexão."
        >
          fuso {fuso}
        </div>
      )}

      {loadingSchema && (
        <div className="statusbar__item">
          <span className="spinner" style={{ width: 10, height: 10 }} />
          carregando schema…
        </div>
      )}

      <div className="statusbar__spacer" />

      {tab?.running && (
        <div className="statusbar__item" title="Cancelar: ⌘.">
          <span className="spinner" style={{ width: 10, height: 10 }} />
          executando… <Cronometro key={tab.id} />
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

      <button
        className="statusbar__item statusbar__item--acao"
        onClick={() => openModal('update')}
        title="Verificar se há atualização"
      >
        v{__APP_VERSION__}
      </button>
    </footer>
  )
}
