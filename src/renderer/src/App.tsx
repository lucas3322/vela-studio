import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { StatusBar } from './components/StatusBar'
import { ConnectionModal } from './components/ConnectionModal'
import { HistoryModal } from './components/HistoryModal'
import { CheatsheetModal } from './components/CheatsheetModal'
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
      <Toast />
    </div>
  )
}
