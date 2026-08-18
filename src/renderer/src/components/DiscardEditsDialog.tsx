import { useEffect } from 'react'
import { IconWarning } from './Icons'

interface Props {
  /** Quantas alterações estão esperando confirmação. */
  quantas: number
  onDescartar: () => void
  onCancel: () => void
}

/**
 * Pergunta antes de executar com alterações de célula pendentes.
 *
 * Executar uma consulta recarrega grades e remonta resultados. O que a pessoa
 * digitou e ainda não aplicou some junto — nunca chegou ao banco, e nada na
 * tela diria que foi perdido.
 *
 * O botão que descarta é o **secundário**, e o "Voltar" é o primário: quem
 * abriu esta janela por engano — que é o caso comum, já que a pessoa apertou
 * ⌘↵ sem lembrar das edições — encontra o caminho seguro embaixo do dedo.
 */
export function DiscardEditsDialog({ quantas, onDescartar, onCancel }: Props): React.JSX.Element {
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onCancel])

  const plural = quantas > 1

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {plural ? `${quantas} alterações não aplicadas` : 'Alteração não aplicada'}
            </div>
            <div className="modal__subtitle">
              {plural ? 'Elas ainda não foram' : 'Ela ainda não foi'} para o banco.
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="update__estado update__estado--aviso">
            <IconWarning size={18} />
            <span>
              Executar agora <strong>descarta</strong> {plural ? 'as alterações' : 'a alteração'} —
              o que você digitou some sem nunca ter sido gravado. Para não perder,
              volte e clique em <strong>Confirmar alterações</strong> na grade.
            </span>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onDescartar}>
            Descartar e executar
          </button>
          <button className="btn btn--primary" onClick={onCancel} autoFocus>
            Voltar e terminar
          </button>
        </div>
      </div>
    </div>
  )
}
