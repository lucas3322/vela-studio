import { useState } from 'react'
import type { QueryError } from '@shared/types'
import { IconWarning } from './Icons'

/**
 * A hierarquia é deliberada: primeiro a mensagem em português, depois a dica
 * acionável, e o texto cru do banco só se o usuário pedir. Quem é experiente
 * abre o cru; quem está aprendendo não precisa vê-lo.
 */
export function ErrorPanel({ error }: { error: QueryError }): React.JSX.Element {
  const [showRaw, setShowRaw] = useState(false)
  const hasTranslation = error.friendly !== error.raw

  return (
    <div className="error-panel">
      <IconWarning size={17} className="error-panel__icon" />
      <div className="error-panel__body">
        <div className="error-panel__title selectable">{error.friendly}</div>
        {error.hint && <div className="error-panel__hint selectable">{error.hint}</div>}

        {hasTranslation && (
          <button className="error-panel__toggle" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Ocultar mensagem original' : 'Ver mensagem original do banco'}
          </button>
        )}

        {(showRaw || !hasTranslation) && (
          <div className="error-panel__raw">
            {error.code && <strong>{error.code}: </strong>}
            {error.raw}
          </div>
        )}
      </div>
    </div>
  )
}
