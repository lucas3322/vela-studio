import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { StatusBar } from './components/StatusBar'
import { ConnectionModal } from './components/ConnectionModal'
import { HistoryModal } from './components/HistoryModal'
import { CheatsheetModal } from './components/CheatsheetModal'
import { UpdateModal } from './components/UpdateModal'
import { SaveQueryModal } from './components/SaveQueryModal'
import { Toast } from './components/Toast'
import { useAppStore } from './store/app'
import { useConnectionStore } from './store/connections'
import { useTabStore } from './store/tabs'
import { useMenuEvents } from './hooks/useMenuEvents'
import './styles/global.css'
import './styles/layout.css'

export function App(): React.JSX.Element {
  const { sidebarVisible, modal, applySystemTheme } = useAppStore()
  const refreshSaved = useConnectionStore((s) => s.refreshSaved)
  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const tabs = useTabStore((s) => s.tabs)
  const openQueryTab = useTabStore((s) => s.openQueryTab)

  useMenuEvents()

  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  // Ao conectar, abre uma aba de query se aquela conexão ainda não tem nenhuma.
  // Reconectar num banco onde já havia abas não cria outra: as antigas voltam.
  useEffect(() => {
    if (!connectionId) return
    const hasTabs = tabs.some((t) => t.connectionId === connectionId)
    if (!hasTabs) openQueryTab({ connectionId, database })
  }, [connectionId, database, tabs, openQueryTab])

  // Checagem silenciosa, no máximo uma por dia. Só avisa quando há versão nova —
  // um app que abre dizendo "você está atualizado" toda vez vira ruído.
  useEffect(() => {
    const ULTIMA = 'vela.ultimaChecagemDeUpdate'
    const umDia = 24 * 60 * 60 * 1000
    const anterior = Number(localStorage.getItem(ULTIMA) ?? 0)
    if (Date.now() - anterior < umDia) return

    const agendado = setTimeout(() => {
      void window.vela.update.check().then((info) => {
        // Só marca a data quando a consulta funcionou: falha de rede não pode
        // silenciar a checagem pelas próximas 24 horas.
        if (info.status === 'erro') return
        localStorage.setItem(ULTIMA, String(Date.now()))
        if (info.status === 'disponivel' || info.status === 'sem-arquivo') {
          useAppStore
            .getState()
            .notify(`Versão ${info.versaoNova} disponível. Abra Atualizações para instalar.`, 'info')
        }
      })
    }, 4000) // depois do primeiro render, para não competir com a abertura

    return () => clearTimeout(agendado)
  }, [])

  // O SO pode trocar de tema no meio da sessão (agendamento noturno do macOS).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent): void =>
      applySystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [applySystemTheme])

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        {sidebarVisible && <Sidebar />}
        <Workspace />
      </div>
      <StatusBar />

      {modal === 'connection' && <ConnectionModal />}
      {modal === 'history' && <HistoryModal />}
      {modal === 'cheatsheet' && <CheatsheetModal />}
      {modal === 'update' && <UpdateModal />}
      {modal === 'saveQuery' && <SaveQueryModal />}
      <Toast />
    </div>
  )
}
