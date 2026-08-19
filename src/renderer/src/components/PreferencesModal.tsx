import { useEffect } from 'react'
import { PALETAS } from '../styles/palettes'
import { useAppStore, type ThemeMode } from '../store/app'
import { IconClose } from './Icons'

const TEMAS: Array<{ id: ThemeMode; rotulo: string }> = [
  { id: 'light', rotulo: 'Claro' },
  { id: 'dark', rotulo: 'Escuro' },
  { id: 'system', rotulo: 'Sistema' }
]

/**
 * Preferências da IDE.
 *
 * O item de menu "Preferências…" e o ⌘, existiam desde o começo, mas não
 * havia nada do outro lado — o atalho simplesmente não fazia nada.
 */
export function PreferencesModal(): React.JSX.Element {
  const {
    closeModal,
    theme,
    setTheme,
    paleta,
    setPaleta,
    limitePreview,
    setLimitePreview,
    tamanhoPaginaPadrao,
    setTamanhoPaginaPadrao,
    limiteAviso,
    setLimiteAviso
  } = useAppStore()

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [closeModal])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Preferências</div>
            <div className="modal__subtitle">Valem para todas as conexões e ficam neste Mac.</div>
          </div>
          <button className="icon-btn" onClick={closeModal} title="Fechar">
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          <div className="field">
            <span className="field__label">Tema</span>
            <div className="segmented">
              {TEMAS.map((item) => (
                <button
                  key={item.id}
                  data-active={theme === item.id}
                  onClick={() => setTheme(item.id)}
                >
                  {item.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">Cor de destaque</span>
            <div className="paletas">
              {PALETAS.map((item) => (
                <button
                  key={item.id}
                  className={`paleta ${paleta === item.id ? 'paleta--ativa' : ''}`}
                  onClick={() => setPaleta(item.id)}
                  title={item.nome}
                  aria-label={item.nome}
                >
                  <span
                    className="paleta__amostra"
                    style={{ background: `hsl(${item.h} ${item.s}% 50%)` }}
                  />
                  {item.nome}
                </button>
              ))}
            </div>
            <span className="field__hint">
              Vale quando a conexão aberta não tem cor própria — a cor da conexão sempre manda,
              para você saber em qual banco está. A lista é fechada de propósito: cada cor foi
              conferida nos dois temas para o texto continuar legível.
            </span>
          </div>

          <div className="field">
            <span className="field__label">Linhas por consulta sem LIMIT</span>
            <input
              className="input"
              type="number"
              min={1}
              max={100000}
              value={limitePreview}
              onChange={(e) => setLimitePreview(Number(e.target.value))}
            />
            <span className="field__hint">
              Quando a query não declara <code>LIMIT</code>, o driver corta aqui. Existe para um{' '}
              <code>SELECT *</code> em tabela grande não travar a IDE — subir muito devolve o
              problema.
            </span>
          </div>

          <div className="field">
            <span className="field__label">Linhas por página na aba de tabela</span>
            <input
              className="input"
              type="number"
              min={1}
              max={10000}
              value={tamanhoPaginaPadrao}
              onChange={(e) => setTamanhoPaginaPadrao(Number(e.target.value))}
            />
            <span className="field__hint">Vale para as próximas abas que você abrir.</span>
          </div>

          <div className="field">
            <span className="field__label">Avisar sobre consulta pesada acima de</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1000000}
              value={limiteAviso}
              onChange={(e) => setLimiteAviso(Number(e.target.value))}
            />
            <span className="field__hint">
              Abaixo disso, o corte do resultado continua sendo informado — só que discretamente,
              embaixo da grade. O aviso em destaque, sugerindo <code>LIMIT</code>, aparece a partir
              deste número.
            </span>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--primary" onClick={closeModal}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
