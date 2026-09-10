import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useConectarSalva } from '../hooks/useConectarSalva'
import { IconSail, IconPlus } from './Icons'
import { ConnectionRow } from './ConnectionRow'

/**
 * Primeira tela de quem abre o app.
 * Se já existem conexões salvas, elas são o conteúdo principal — clicar e
 * conectar deve ser o caminho mais curto. Sem nenhuma, viramos onboarding.
 */
export function WelcomeScreen(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const saved = useConnectionStore((s) => s.saved)
  const connecting = useConnectionStore((s) => s.connecting)
  const removeConnection = useConnectionStore((s) => s.removeConnection)
  const handleConnect = useConectarSalva()

  return (
    <div className="welcome">
      <IconSail size={44} className="welcome__logo" />
      <div>
        <div className="welcome__title">Vela Studio</div>
        <p className="welcome__text">
          {saved.length > 0
            ? 'Escolha uma conexão para começar.'
            : 'Conecte um banco MySQL, PostgreSQL, SQLite ou MongoDB e escreva consultas com ajuda de verdade: o editor conhece suas tabelas e explica cada comando.'}
        </p>
      </div>

      {saved.length > 0 && (
        <div className="welcome__list">
          {saved.slice(0, 6).map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              disabled={connecting}
              onOpen={() => void handleConnect(connection.id)}
              onEdit={() => openModal('connection', connection.id)}
              onRemove={() => void removeConnection(connection.id)}
            />
          ))}
        </div>
      )}

      <button className="btn btn--primary" onClick={() => openModal('connection')}>
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
