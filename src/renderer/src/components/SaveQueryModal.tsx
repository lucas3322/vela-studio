import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { IconClose } from './Icons'

/**
 * Dá nome a uma query antes de guardá-la.
 *
 * Quando a aba já veio de uma query salva, o padrão é **atualizar** aquela
 * entrada: salvar de novo depois de cada ajuste criaria uma pilha de cópias
 * quase iguais. Quem quiser bifurcar tem o botão "Salvar como nova".
 */
export function SaveQueryModal(): React.JSX.Element | null {
  const closeModal = useAppStore((s) => s.closeModal)
  const notify = useAppStore((s) => s.notify)
  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const updateTab = useTabStore((s) => s.updateTab)
  const tab = useTabStore((s) => s.activeTabFor(s.tabs.length ? connectionId : null))

  const [nome, setNome] = useState(tab?.title ?? '')
  const [salvando, setSalvando] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    campo.current?.select()
  }, [])

  if (!tab || tab.kind !== 'query' || !connectionId) return null

  const jaSalva = !!tab.savedQueryId

  const salvar = async (comoNova: boolean): Promise<void> => {
    const limpo = nome.trim()
    if (!limpo || salvando) return

    setSalvando(true)
    try {
      const registro = await window.vela.saved.save({
        id: comoNova || !tab.savedQueryId ? crypto.randomUUID() : tab.savedQueryId,
        name: limpo,
        sql: tab.sql,
        connectionId,
        database: database ?? undefined
      })
      // A aba passa a apontar para o registro, senão o próximo ⌘S duplicaria.
      updateTab(tab.id, { savedQueryId: registro.id, title: limpo, dirty: false })
      // A lista da barra lateral escuta este evento para se atualizar sozinha.
      window.dispatchEvent(new Event('vela:saved-changed'))
      notify(`"${limpo}" foi salva.`, 'success')
      closeModal()
    } catch (error) {
      notify((error as Error).message, 'danger')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">{jaSalva ? 'Atualizar query' : 'Salvar query'}</div>
            <div className="modal__subtitle">
              {tab.sql.trim()
                ? 'Ela aparece na aba "Salvas" da barra lateral.'
                : 'Esta aba está vazia — não há SQL para guardar.'}
            </div>
          </div>
          <button className="icon-btn" onClick={closeModal} title="Fechar">
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          <label className="field">
            <span className="field__label">Nome</span>
            <input
              ref={campo}
              className="input"
              value={nome}
              autoFocus
              placeholder="Ex.: contas ativas por cidade"
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void salvar(false)
                if (e.key === 'Escape') closeModal()
              }}
            />
          </label>

          <pre className="salvar__previa">{tab.sql.trim() || '(vazio)'}</pre>
        </div>

        <div className="modal__footer">
          <button className="btn btn--secondary" onClick={closeModal}>
            Cancelar
          </button>
          {jaSalva && (
            <button
              className="btn btn--secondary"
              onClick={() => void salvar(true)}
              disabled={!nome.trim() || !tab.sql.trim() || salvando}
            >
              Salvar como nova
            </button>
          )}
          <button
            className="btn btn--primary"
            onClick={() => void salvar(false)}
            disabled={!nome.trim() || !tab.sql.trim() || salvando}
          >
            {jaSalva ? 'Atualizar' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
