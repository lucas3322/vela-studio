import { useEffect, useState } from 'react'
import { IconWarning } from './Icons'

interface Props {
  /** Os comandos sem WHERE encontrados, na ordem em que apareceram. */
  comandos: string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmação de `UPDATE` ou `DELETE` sem `WHERE`.
 *
 * Um comando desses atinge a tabela inteira, e não existe desfazer depois do
 * commit. Quase sempre é engano — o `WHERE` que ficou para trás, a linha
 * selecionada por descuido no editor — e o preço do engano é a tabela toda.
 *
 * Exige digitar a palavra, como o diálogo de `DROP`: um Enter distraído não
 * pode bastar. O comando aparece na íntegra, porque ninguém deveria aprovar o
 * que não consegue ler.
 */
export function UnboundedMutationDialog({
  comandos,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const [digitado, setDigitado] = useState('')
  const CONFIRMACAO = 'CONFIRMO'
  const podeSeguir = digitado.trim().toUpperCase() === CONFIRMACAO

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onCancel])

  const plural = comandos.length > 1

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {plural ? 'Comandos sem WHERE' : 'Comando sem WHERE'}
            </div>
            <div className="modal__subtitle">
              {plural
                ? 'Estes comandos vão atingir todas as linhas das tabelas.'
                : 'Este comando vai atingir todas as linhas da tabela.'}
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="update__estado update__estado--aviso">
            <IconWarning size={18} />
            <span>
              Sem <code>WHERE</code>, {plural ? 'eles alcançam' : 'ele alcança'} a tabela inteira —
              e <strong>não há como desfazer</strong> depois de confirmado. Se a intenção era
              alterar algumas linhas, cancele e acrescente a condição.
            </span>
          </div>

          <div>
            <div className="field__label" style={{ marginBottom: 6 }}>
              {plural ? 'Comandos que serão executados' : 'Comando que será executado'}
            </div>
            <pre className="update__notas">{comandos.join('\n\n')}</pre>
          </div>

          <label className="field">
            <span className="field__label">
              Para seguir, digite <code>{CONFIRMACAO}</code>
            </span>
            <input
              className="input"
              value={digitado}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={CONFIRMACAO}
              onChange={(e) => setDigitado(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && podeSeguir) onConfirm()
              }}
            />
          </label>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button className="btn btn--danger" onClick={onConfirm} disabled={!podeSeguir}>
            Executar mesmo assim
          </button>
        </div>
      </div>
    </div>
  )
}
