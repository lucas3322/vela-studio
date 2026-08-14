import { useEffect } from 'react'
import { IconDownload, IconWarning } from './Icons'

const numero = new Intl.NumberFormat('pt-BR')

interface Props {
  /** Em quantas linhas o resultado na tela foi cortado. */
  mostrando: number
  formato: 'csv' | 'json'
  onTudo: () => void
  onVisivel: () => void
  onCancel: () => void
}

/**
 * Escolha de escopo quando o resultado da aba está cortado.
 *
 * Existe porque as duas opções são legítimas e a IDE não tem como saber qual
 * é a certa. Antes ela escolhia sozinha — sempre a errada, e sem dizer:
 * gravava o recorte visível e anunciava "Salvo em…" em verde, e quem abrisse
 * o arquivo concluiria sobre a tabela inteira olhando um centésimo dela.
 *
 * O padrão visual é o do diálogo de comando sem WHERE: o que vai acontecer
 * aparece por escrito antes de acontecer.
 */
export function ExportChoiceDialog({
  mostrando,
  formato,
  onTudo,
  onVisivel,
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
            <div className="modal__title">O que você quer no arquivo?</div>
            <div className="modal__subtitle">
              A tela está mostrando {numero.format(mostrando)} linhas — o banco tem mais.
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="update__estado update__estado--aviso">
            <IconWarning size={18} />
            <span>
              Exportar só o que está na tela grava <strong>{numero.format(mostrando)} linhas</strong>,
              e o arquivo não terá nada dizendo que faltou o resto.
            </span>
          </div>

          <div className="escolha">
            <button className="escolha__opcao escolha__opcao--principal" onClick={onTudo}>
              <span className="escolha__titulo">
                <IconDownload size={14} />
                Tudo o que a consulta devolve
              </span>
              <span className="escolha__detalhe">
                Refaz a consulta no banco e grava linha por linha, sem teto. Acima de 1.048.576
                linhas o arquivo é dividido, para continuar abrindo em planilha.
              </span>
            </button>

            <button className="escolha__opcao" onClick={onVisivel}>
              <span className="escolha__titulo">Só as {numero.format(mostrando)} linhas da tela</span>
              <span className="escolha__detalhe">
                Rápido, sem consultar o banco de novo. Serve para conferir um recorte, não para
                analisar o conjunto.
              </span>
            </button>
          </div>
        </div>

        <div className="modal__footer">
          <span className="modal__nota">Formato: {formato.toUpperCase()}</span>
          <button className="btn btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
