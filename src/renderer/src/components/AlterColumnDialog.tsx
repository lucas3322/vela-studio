import { useEffect } from 'react'
import { IconWarning } from './Icons'

interface Props {
  table: string
  column: string
  /** SQL exato que será executado — montado pelo driver, nunca pela UI. */
  statement: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmação da troca de tipo de uma coluna.
 *
 * Mostra o comando na íntegra pelo mesmo motivo do `DangerDialog`: ninguém
 * aprova o que não consegue ler. E aqui ler importa mais que de costume — no
 * MySQL o `MODIFY COLUMN` reescreve a definição inteira, então é no texto que
 * se confere se `NOT NULL`, `DEFAULT` e `COMMENT` continuam lá.
 *
 * Diferente do `DROP`, não exigimos digitar o nome: trocar tipo é operação de
 * rotina, e atrito demais empurra a pessoa a fazer por fora, sem revisão
 * nenhuma. O aviso de truncamento fica em destaque no lugar disso.
 */
export function AlterColumnDialog({
  table,
  column,
  statement,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onCancel])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Alterar tipo da coluna</div>
            <div className="modal__subtitle">
              <code>{table}</code>.<code>{column}</code>
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="update__estado update__estado--aviso">
            <IconWarning size={18} />
            <span>
              Reduzir o tamanho de um tipo <strong>corta o que não couber</strong>, e não há
              desfazer. Em tabelas grandes o banco pode reescrever a tabela inteira e travar
              gravações enquanto isso.
            </span>
          </div>

          <div>
            <div className="field__label" style={{ marginBottom: 6 }}>
              Comando que será executado
            </div>
            <pre className="update__notas">{statement}</pre>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={onConfirm}>
            Executar alteração
          </button>
        </div>
      </div>
    </div>
  )
}
