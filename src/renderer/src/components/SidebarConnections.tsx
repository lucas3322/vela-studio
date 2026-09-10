import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useConectarSalva } from '../hooks/useConectarSalva'
import { ConnectionRow } from './ConnectionRow'
import { IconPlus } from './Icons'

/**
 * A lista de conexões na barra lateral, quando não há nenhuma ativa.
 *
 * Desconectado, a barra lateral não tem schema para mostrar: a árvore de
 * tabelas e as queries salvas pertencem a UMA conexão, e exibi-las sem conexão
 * é resíduo da sessão anterior, não informação — a pessoa vê nomes de tabelas
 * de um banco ao qual não está mais ligada. No lugar entra o que faz sentido
 * ali sem conexão: a própria lista para reconectar, sem precisar ir ao centro
 * da tela.
 */
export function SidebarConnections(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const saved = useConnectionStore((s) => s.saved)
  const connecting = useConnectionStore((s) => s.connecting)
  const removeConnection = useConnectionStore((s) => s.removeConnection)
  const conectar = useConectarSalva()

  return (
    <div className="sidebar__conexoes">
      <div className="sidebar__header">
        <span>Conexões{saved.length ? ` · ${saved.length}` : ''}</span>
      </div>

      {saved.length === 0 ? (
        <div className="sidebar__conexoes-vazio">Nenhuma conexão salva ainda.</div>
      ) : (
        <div className="sidebar__conexoes-lista">
          {saved.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              disabled={connecting}
              onOpen={() => void conectar(connection.id)}
              onEdit={() => openModal('connection', connection.id)}
              onRemove={() => void removeConnection(connection.id)}
            />
          ))}
        </div>
      )}

      <div className="sidebar__conexoes-nova">
        <button
          className="btn btn--secondary"
          style={{ width: '100%' }}
          onClick={() => openModal('connection')}
        >
          <IconPlus size={13} />
          Nova conexão
        </button>
      </div>
    </div>
  )
}
