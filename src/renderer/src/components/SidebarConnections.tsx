import { useMemo } from 'react'
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
 * é resíduo da sessão anterior, não informação. No lugar entra o que faz
 * sentido ali: a própria lista para reconectar, sem ir ao centro da tela.
 *
 * ## Recentes e Salvas
 *
 * Divididas por uso, não duplicadas: **Recentes** são as que já foram abertas
 * (têm `lastUsedAt`, que o main grava ao conectar), mais recente primeiro;
 * **Salvas** são as que existem mas nunca foram abertas nesta máquina. Cada
 * conexão aparece em um grupo só — repetir a mesma conexão em duas listas seria
 * o mesmo tipo de redundância que tirar a lista do centro veio resolver.
 */
export function SidebarConnections(): React.JSX.Element {
  const openModal = useAppStore((s) => s.openModal)
  const saved = useConnectionStore((s) => s.saved)
  const connecting = useConnectionStore((s) => s.connecting)
  const removeConnection = useConnectionStore((s) => s.removeConnection)
  const conectar = useConectarSalva()

  // O store já entrega `saved` ordenado por lastUsedAt desc; aqui só separamos
  // quem tem uso registrado de quem nunca foi aberta.
  const { recentes, salvas } = useMemo(() => {
    return {
      recentes: saved.filter((c) => c.lastUsedAt),
      salvas: saved.filter((c) => !c.lastUsedAt)
    }
  }, [saved])

  const linha = (id: string): React.JSX.Element => {
    const connection = saved.find((c) => c.id === id)!
    return (
      <ConnectionRow
        key={connection.id}
        connection={connection}
        compacta
        disabled={connecting}
        onOpen={() => void conectar(connection.id)}
        onEdit={() => openModal('connection', connection.id)}
        onRemove={() => void removeConnection(connection.id)}
      />
    )
  }

  return (
    <div className="sidebar__conexoes">
      {saved.length === 0 ? (
        <div className="sidebar__conexoes-vazio">Nenhuma conexão salva ainda.</div>
      ) : (
        <div className="sidebar__conexoes-lista">
          {recentes.length > 0 && (
            <>
              <div className="sidebar__header">
                <span>Recentes · {recentes.length}</span>
              </div>
              {recentes.map((c) => linha(c.id))}
            </>
          )}

          {salvas.length > 0 && (
            <>
              <div className="sidebar__header">
                <span>Salvas · {salvas.length}</span>
              </div>
              {salvas.map((c) => linha(c.id))}
            </>
          )}
        </div>
      )}

      <div className="sidebar__conexoes-nova">
        <button
          className="btn btn--secondary"
          style={{ width: '100%' }}
          onClick={() => openModal('connection', undefined, { novaConexao: true })}
        >
          <IconPlus size={13} />
          Nova conexão
        </button>
      </div>
    </div>
  )
}
