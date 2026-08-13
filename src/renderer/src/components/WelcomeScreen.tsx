import { DRIVERS, type StoredConnection } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { IconSail, IconPlus } from './Icons'
import { ConnectionRow } from './ConnectionRow'

/**
 * A conexão exige senha e não tem nenhuma guardada?
 * SQLite não usa senha, e uma string de conexão normalmente já a carrega.
 */
export function needsPassword(connection: StoredConnection): boolean {
  if (connection.hasPassword) return false
  if (!DRIVERS[connection.driver].fields.includes('password')) return false
  if (connection.connectionString?.trim()) return false
  return true
}

/**
 * Primeira tela de quem abre o app.
 * Se já existem conexões salvas, elas são o conteúdo principal — clicar e
 * conectar deve ser o caminho mais curto. Sem nenhuma, viramos onboarding.
 */
export function WelcomeScreen(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const notify = useAppStore((s) => s.notify)
  const saved = useConnectionStore((s) => s.saved)
  const connect = useConnectionStore((s) => s.connect)
  const connecting = useConnectionStore((s) => s.connecting)
  const removeConnection = useConnectionStore((s) => s.removeConnection)

  const handleConnect = async (id: string): Promise<void> => {
    const stored = saved.find((c) => c.id === id)
    if (!stored) return

    // Sem senha guardada, tentar conectar só produziria um "Access denied"
    // do banco. Abrimos o formulário já preenchido para pedir a senha —
    // é a única coisa que falta, e o usuário sabe qual é.
    if (needsPassword(stored)) {
      openModal('connection', stored.id)
      notify('Informe a senha para conectar.', 'info')
      return
    }

    try {
      // A senha vem cifrada do store; `undefined` sinaliza ao main que ele resolve.
      await connect({ ...stored, password: undefined })
      notify(`Conectado a ${stored.name}`, 'success')
    } catch (error) {
      notify((error as Error).message, 'danger')
    }
  }

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
