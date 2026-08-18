import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { CHAVE_DO_TOUR, jaViuOTour } from './editor/tour'
import { DiscardEditsDialog } from './components/DiscardEditsDialog'
import { Tour } from './components/Tour'
import { UpdateBanner } from './components/UpdateBanner'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { StatusBar } from './components/StatusBar'
import { ConnectionModal } from './components/ConnectionModal'
import { HistoryModal } from './components/HistoryModal'
import { CheatsheetModal } from './components/CheatsheetModal'
import { UpdateModal } from './components/UpdateModal'
import { SaveQueryModal } from './components/SaveQueryModal'
import { PreferencesModal } from './components/PreferencesModal'
import { UnboundedMutationDialog } from './components/UnboundedMutationDialog'
import { Toast } from './components/Toast'
import { useAppStore } from './store/app'
import { useConnectionStore } from './store/connections'
import { useTabStore } from './store/tabs'
import { useMenuEvents } from './hooks/useMenuEvents'
import './styles/global.css'
import './styles/layout.css'

export function App(): React.JSX.Element {
  const { sidebarVisible, modal, applySystemTheme } = useAppStore()
  const confirmacaoDeEscrita = useAppStore((s) => s.confirmacaoDeEscrita)
  const fecharConfirmacaoDeEscrita = useAppStore((s) => s.fecharConfirmacaoDeEscrita)
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

  /*
    Tour na primeira conexão, uma vez só.
    Antes de conectar, metade do que ele aponta não existe — não há tabelas
    para buscar nem botão de desconectar. Por isso o gatilho é a conexão, não
    a abertura do app.

    O atraso deixa a barra lateral terminar de montar: medir um elemento que
    ainda não existe destacaria o canto da tela.
  */
  const confirmacaoDeDescarte = useAppStore((s) => s.confirmacaoDeDescarte)
  const fecharDescarteDeEdicoes = useAppStore((s) => s.fecharDescarteDeEdicoes)

  const [mostrarTour, setMostrarTour] = useState(false)
  useEffect(() => {
    if (!connectionId) return
    if (jaViuOTour(localStorage.getItem(CHAVE_DO_TOUR))) return
    const agendado = setTimeout(() => setMostrarTour(true), 900)
    return () => clearTimeout(agendado)
  }, [connectionId])

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

      <UpdateBanner />

      {mostrarTour && <Tour aoFechar={() => setMostrarTour(false)} />}

      {confirmacaoDeDescarte && (
        <DiscardEditsDialog
          quantas={confirmacaoDeDescarte.quantas}
          onDescartar={confirmacaoDeDescarte.aoConfirmar}
          onCancel={fecharDescarteDeEdicoes}
        />
      )}

      {modal === 'connection' && <ConnectionModal />}
      {modal === 'history' && <HistoryModal />}
      {modal === 'cheatsheet' && <CheatsheetModal />}
      {modal === 'update' && <UpdateModal />}
      {modal === 'saveQuery' && <SaveQueryModal />}
      {modal === 'preferences' && <PreferencesModal />}
      {confirmacaoDeEscrita && (
        <UnboundedMutationDialog
          comandos={confirmacaoDeEscrita.comandos}
          onConfirm={() => {
            const { aoConfirmar } = confirmacaoDeEscrita
            fecharConfirmacaoDeEscrita()
            aoConfirmar()
          }}
          onCancel={fecharConfirmacaoDeEscrita}
        />
      )}
      <Toast />
    </div>
  )
}
