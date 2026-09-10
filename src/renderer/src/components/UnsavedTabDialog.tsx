import { useEffect } from 'react'
import { useAppStore } from '../store/app'
import { useTabStore } from '../store/tabs'
import { IconWarning } from './Icons'

/**
 * Pergunta antes de fechar uma aba de query com SQL não salvo.
 *
 * O texto daquela aba não existe em lugar nenhum além dela: não está no banco,
 * não está na lista de queries salvas, e fechar não tem desfazer. Uma tabela
 * ou um diagrama podem ser reabertos do banco a qualquer momento — SQL
 * digitado, não.
 *
 * Como no `DiscardEditsDialog`, o botão que **descarta** é o secundário e o
 * seguro é o primário: quem chegou aqui clicou no × sem lembrar do que tinha
 * escrito, então o caminho de volta é o que fica embaixo do dedo.
 *
 * O terceiro caminho, "Salvar…", existe porque é o que a pessoa realmente
 * queria: salvar marca a aba como limpa, e daí o fechamento seguinte não
 * pergunta mais nada.
 */
export function UnsavedTabDialog(): React.JSX.Element | null {
  const fechamentoPendente = useTabStore((s) => s.fechamentoPendente)
  const tabs = useTabStore((s) => s.tabs)
  const closeTab = useTabStore((s) => s.closeTab)
  const cancelarFechamento = useTabStore((s) => s.cancelarFechamento)
  const setActive = useTabStore((s) => s.setActive)
  const openModal = useAppStore((s) => s.openModal)

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') cancelarFechamento()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [cancelarFechamento])

  if (!fechamentoPendente) return null

  const aba = tabs.find((t) => t.id === fechamentoPendente)
  if (!aba) return null

  const linhas = aba.sql.trim().split('\n').length

  const salvar = (): void => {
    // Salvar é sobre a aba ativa: focá-la antes evita salvar o conteúdo de
    // outra aba quando o fechamento partiu do ⌘W ou do botão do meio.
    setActive(aba.id)
    cancelarFechamento()
    openModal('saveQuery')
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && cancelarFechamento()}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">{aba.title} não foi salva</div>
            <div className="modal__subtitle">
              {linhas > 1 ? `${linhas} linhas de SQL` : 'SQL'} que só existe nesta aba.
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="update__estado update__estado--aviso">
            <IconWarning size={18} />
            <span>
              Fechar agora <strong>descarta</strong> o que você escreveu — não está no banco nem
              na lista de queries salvas, e não há como recuperar depois.
            </span>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={() => closeTab(aba.id)}>
            Descartar e fechar
          </button>
          <span className="modal__espaco" />
          <button className="btn btn--secondary" onClick={salvar}>
            Salvar…
          </button>
          <button className="btn btn--primary" onClick={cancelarFechamento} autoFocus>
            Voltar para a aba
          </button>
        </div>
      </div>
    </div>
  )
}
