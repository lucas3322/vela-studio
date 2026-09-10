import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { IconSail, IconPlus } from './Icons'

/**
 * Primeira tela de quem abre o app — a tela vazia, quando não há conexão ativa.
 *
 * A lista de conexões vive na barra lateral (ver `SidebarConnections`); aqui no
 * centro ela seria a mesma lista uma segunda vez. Então o centro fica só com a
 * marca e o único gesto que a lateral não repete: criar uma conexão nova.
 */
export function WelcomeScreen(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const temConexoes = useConnectionStore((s) => s.saved.length > 0)

  return (
    <div className="welcome">
      <IconSail size={44} className="welcome__logo" />
      <div>
        <div className="welcome__title">Vela Studio</div>
        <p className="welcome__text">
          {temConexoes
            ? 'Escolha uma conexão na barra lateral para começar.'
            : 'Conecte um banco MySQL, PostgreSQL, SQLite, MongoDB ou Redis e escreva consultas com ajuda de verdade: o editor conhece suas tabelas e explica cada comando.'}
        </p>
      </div>

      <button
        className="btn btn--primary"
        onClick={() => openModal('connection', undefined, { novaConexao: true })}
      >
        <IconPlus size={13} />
        Nova conexão
      </button>

      {/*
        Versão e commit, discretos. Quem vem reportar um problema encontra
        aqui o que precisa informar, sem ter que abrir o menu Sobre.
      */}
      <div className="welcome__version selectable">
        v{__APP_VERSION__} · {__GIT_SHA__}
      </div>

      {/* Crédito de autoria, sem link: a IDE não manda ninguém para fora. */}
      <div className="welcome__autor">criado por Lucas Pardinho</div>
    </div>
  )
}
