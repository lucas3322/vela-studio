import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { corDaConexao } from '../styles/connection-colors'
import {
  IconHelp,
  IconHistory,
  IconSail,
  IconMoon,
  IconSettings,
  IconSidebar,
  IconSun
} from './Icons'

export function TitleBar(): React.JSX.Element {
  const {
    sidebarVisible,
    toggleSidebar,
    helpPanelVisible,
    toggleHelpPanel,
    resolvedTheme,
    setTheme,
    openModal
  } = useAppStore()
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const database = useConnectionStore((s) => s.activeDatabase)

  const cor = corDaConexao(connection?.color, resolvedTheme)

  return (
    <header className="titlebar drag-region">
      {/*
        Faixa da cor da conexão, atravessando o topo.

        É o único sinal que fica visível o tempo todo, em qualquer aba e com
        qualquer painel aberto. O nome do banco também está aqui ao lado, mas
        nome se lê e cor se percebe — e quem vai rodar um DELETE às pressas não
        está lendo.
      */}
      {cor && <span className="titlebar__faixa" style={{ background: cor }} aria-hidden />}

      <div className="titlebar__brand no-drag">
        <IconSail size={15} />
        Vela
      </div>

      <button
        className={`icon-btn no-drag ${sidebarVisible ? 'icon-btn--active' : ''}`}
        onClick={toggleSidebar}
        title="Alternar barra lateral (⌘B)"
      >
        <IconSidebar />
      </button>

      <div className="titlebar__title">
        {connection ? `${connection.name}${database ? ` — ${database}` : ''}` : 'Nenhuma conexão'}
      </div>

      <div className="titlebar__actions no-drag">
        <button
          className="icon-btn"
          onClick={() => openModal('history')}
          data-tour="historico"
          title="Histórico de queries (⌘⇧H)"
        >
          <IconHistory />
        </button>
        <button
          className={`icon-btn ${helpPanelVisible ? 'icon-btn--active' : ''}`}
          onClick={toggleHelpPanel}
          data-tour="receitas"
          title="Painel de receitas (⌘J)"
        >
          <IconHelp />
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          data-tour="tema"
          title={resolvedTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        >
          {resolvedTheme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <button
          className="icon-btn"
          onClick={() => openModal('preferences')}
          data-tour="preferencias"
          title="Preferências (⌘,)"
        >
          <IconSettings />
        </button>
      </div>
    </header>
  )
}
