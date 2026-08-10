import { useEffect, useState } from 'react'
import { IconWarning } from './Icons'

interface Props {
  kind: 'truncate' | 'drop'
  table: string
  /** SQL exato que será executado — montado pelo driver, não pela UI. */
  statement: string
  onConfirm: () => void
  onOpenInEditor: () => void
  onCancel: () => void
}

/**
 * Confirmação de operação destrutiva.
 *
 * Três decisões de propósito:
 * 1. O SQL exato aparece na tela. Ninguém aprova o que não consegue ler.
 * 2. `DROP` exige digitar o nome da tabela. É irreversível; um clique
 *    acidental não pode bastar.
 * 3. Existe a saída "abrir no editor", para quem prefere revisar e rodar
 *    junto de outros comandos, dentro de uma transação.
 */
export function DangerDialog({
  kind,
  table,
  statement,
  onConfirm,
  onOpenInEditor,
  onCancel
}: Props): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const requiresTyping = kind === 'drop'
  const canConfirm = !requiresTyping || typed.trim() === table

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const title = kind === 'truncate' ? 'Esvaziar tabela' : 'Apagar tabela'
  const explanation =
    kind === 'truncate'
      ? `Todas as linhas de ${table} serão removidas. A estrutura da tabela permanece.`
      : `A tabela ${table} e todos os seus dados serão removidos do banco.`

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ width: 'min(520px, calc(100vw - 64px))' }}>
        <div className="modal__header">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <IconWarning size={19} style={{ color: 'var(--danger)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div className="modal__title">{title}</div>
              <div className="modal__subtitle">{explanation}</div>
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="field">
            <span className="field__label">Comando que será executado</span>
            <pre className="danger-dialog__sql selectable">{statement}</pre>
          </div>

          <div className="danger-dialog__warning">
            <IconWarning size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Esta operação <strong>não pode ser desfeita</strong>. Se o banco for de produção,
              confirme que existe backup recente.
            </span>
          </div>

          {requiresTyping && (
            <div className="field">
              <span className="field__label">
                Digite <code>{table}</code> para liberar o botão
              </span>
              <input
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={table}
                autoFocus
                spellCheck={false}
              />
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost modal__footer-left" onClick={onOpenInEditor}>
            Abrir no editor
          </button>
          <button className="btn btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn btn--destructive"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {kind === 'truncate' ? 'Esvaziar' : 'Apagar'}
          </button>
        </div>
      </div>
    </div>
  )
}
