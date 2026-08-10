import { DRIVERS } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { IconDatabase, IconLeaf, IconPlus } from './Icons'

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

  const handleConnect = async (id: string): Promise<void> => {
    const stored = saved.find((c) => c.id === id)
    if (!stored) return
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
      <IconLeaf size={44} className="welcome__logo" />
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
            <button
              key={connection.id}
              className="welcome__item"
              onClick={() => void handleConnect(connection.id)}
              disabled={connecting}
            >
              <IconDatabase size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span className="welcome__item-body">
                <div className="welcome__item-name">{connection.name}</div>
                <div className="welcome__item-meta">
                  {connection.filePath ??
                    `${connection.host ?? 'localhost'}${connection.port ? `:${connection.port}` : ''}${
                      connection.database ? `/${connection.database}` : ''
                    }`}
                </div>
              </span>
              <span className="badge">{DRIVERS[connection.driver].label.split(' ')[0]}</span>
            </button>
          ))}
        </div>
      )}

      <button className="btn btn--primary" onClick={() => openModal('connection')}>
        <IconPlus size={13} />
        Nova conexão
      </button>
    </div>
  )
}
