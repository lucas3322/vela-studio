import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { corDaConexao } from '../styles/connection-colors'
import { DRIVERS } from '@shared/types'
import {
  IconHelp,
  IconHistory,
  IconMoon,
  IconSearch,
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
  const openCommandPalette = useAppStore((s) => s.openCommandPalette)
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

      {/*
        Com a barra lateral aberta, o botão de recolhê-la mora nela, ao lado
        dos semáforos. Fechada, ele vem para cá — senão a pessoa perde o
        caminho de volta junto com a barra.
      */}
      {!sidebarVisible && (
        <button
          className="icon-btn no-drag"
          onClick={toggleSidebar}
          title="Mostrar barra lateral (⌘B)"
        >
          <IconSidebar />
        </button>
      )}

      {/*
        Título à esquerda, como na barra unificada do macOS: nome em peso,
        banco em secundário. Centralizado ele flutuava longe de tudo, sem
        pertencer nem ao conteúdo nem às ações.
      */}
      <div className="titlebar__title">
        {connection ? (
          <>
            <span className="titlebar__nome">{connection.name}</span>
            {database && <span className="titlebar__banco">{database}</span>}
            <span className="titlebar__driver">{DRIVERS[connection.driver].label}</span>
          </>
        ) : (
          <span className="titlebar__nome titlebar__nome--vazio">Vela Studio</span>
        )}
      </div>

      {/*
        Atalho visível para a paleta. Quem nunca leu o menu descobre o ⌘K
        aqui; quem já sabe nem olha para ele.
      */}
      <button
        className="titlebar__busca no-drag"
        onClick={() => openCommandPalette()}
        title="Ir para qualquer lugar (⌘K)"
      >
        <IconSearch size={13} />
        <span>Ir para…</span>
        <kbd>⌘K</kbd>
      </button>

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
