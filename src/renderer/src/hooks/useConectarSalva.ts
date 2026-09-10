import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { needsPassword } from '../utils/connection'

/**
 * Conectar a uma conexão salva pelo id.
 *
 * Vive num hook porque duas telas fazem o mesmo gesto — a tela inicial e a
 * lista da barra lateral quando não há conexão ativa — e o fluxo tem uma
 * sutileza que não pode divergir entre elas: sem senha guardada, conectar
 * direto só produz "Access denied" do banco, então abrimos o formulário já
 * preenchido pedindo só a senha. A senha vem cifrada do store; `undefined`
 * sinaliza ao main que ele a resolve.
 */
export function useConectarSalva(): (id: string) => Promise<void> {
  const openModal = useAppStore((s) => s.openModal)
  const notify = useAppStore((s) => s.notify)
  const saved = useConnectionStore((s) => s.saved)
  const connect = useConnectionStore((s) => s.connect)

  return async (id: string): Promise<void> => {
    const stored = saved.find((c) => c.id === id)
    if (!stored) return

    if (needsPassword(stored)) {
      openModal('connection', stored.id)
      notify('Informe a senha para conectar.', 'info')
      return
    }

    try {
      await connect({ ...stored, password: undefined })
      notify(`Conectado a ${stored.name}`, 'success')
    } catch (error) {
      notify((error as Error).message, 'danger')
    }
  }
}
