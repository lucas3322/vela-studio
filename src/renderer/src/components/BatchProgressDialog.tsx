import { useEffect, useRef } from 'react'
import { descreverLote, resumirComando, resumirLote, type PassoDoLote } from '../editor/lote'
import { IconCheck, IconClose, IconWarning } from './Icons'

interface Props {
  passos: PassoDoLote[]
  rodando: boolean
  /** Presente só quando o lote parou num erro: a decisão de seguir dali. */
  continuar?: () => void
  onFechar: () => void
}

/**
 * Andamento de um lote de comandos.
 *
 * ## O que ele responde
 *
 * Depois de rodar dez comandos e um quebrar, a pessoa tem três perguntas, e as
 * três precisam de resposta na mesma tela: **qual** quebrou, **por quê**, e
 * **o que já entrou no banco**. Antes, um lote com erro devolvia uma mensagem
 * só, sem dizer em qual comando parou nem o que tinha sido aplicado — e um
 * banco em estado desconhecido é pior do que um erro claro.
 *
 * ## Por que a lista fica depois de terminar
 *
 * Some sozinha só quando tudo deu certo, e mesmo assim depois de um instante.
 * Com erro ela fica aberta: fechá-la automaticamente jogaria fora a única
 * chance de ler qual comando falhou.
 */
export function BatchProgressDialog({
  passos,
  rodando,
  continuar,
  onFechar
}: Props): React.JSX.Element {
  const resumo = resumirLote(passos)
  const lista = useRef<HTMLDivElement>(null)

  // Segue o comando em execução, e para no que falhou. Num lote de trinta, o
  // interessante sai da tela em segundos.
  useEffect(() => {
    const alvo =
      resumo.indiceDoErro ?? passos.findIndex((p) => p.estado === 'rodando')
    if (alvo < 0) return
    lista.current?.querySelector(`[data-passo="${alvo}"]`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    })
  }, [passos, resumo.indiceDoErro])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      // Escape não fecha durante a execução: sair no meio deixaria comandos
      // rodando sem ninguém olhando o resultado.
      if (evento.key === 'Escape' && !rodando) onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar, rodando])

  const passoComErro = resumo.indiceDoErro != null ? passos[resumo.indiceDoErro] : undefined

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !rodando && onFechar()}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {rodando
                ? `Executando ${resumo.ok + 1} de ${resumo.total}`
                : resumo.erros > 0
                  ? 'O lote parou num erro'
                  : 'Lote concluído'}
            </div>
            <div className="modal__subtitle">{descreverLote(passos)}</div>
          </div>
          <button className="icon-btn" onClick={onFechar} disabled={rodando}>
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          <div className="lote" ref={lista}>
            {passos.map((passo, indice) => (
              <div
                key={indice}
                data-passo={indice}
                className={`lote__passo lote__passo--${passo.estado}`}
              >
                <span className="lote__numero">{indice + 1}</span>

                <span className="lote__marca">
                  {passo.estado === 'rodando' && <span className="spinner" />}
                  {passo.estado === 'ok' && <IconCheck size={13} />}
                  {passo.estado === 'erro' && <IconWarning size={13} />}
                </span>

                <code className="lote__sql" title={passo.sql}>
                  {resumirComando(passo.sql)}
                </code>

                <span className="lote__medida">
                  {passo.estado === 'ok' &&
                    `${passo.linhas ?? 0} linha(s) · ${passo.duracaoMs ?? 0} ms`}
                  {passo.estado === 'espera' && 'na fila'}
                </span>
              </div>
            ))}
          </div>

          {/*
            O erro completo aparece uma vez, embaixo — com a dica que o
            tradutor já produz. Repetir a mensagem inteira dentro da linha da
            lista deixaria as duas ilegíveis.
          */}
          {passoComErro?.erro && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>
                <strong>Comando {(resumo.indiceDoErro ?? 0) + 1}:</strong>{' '}
                {passoComErro.erro.friendly}
                {passoComErro.erro.hint && (
                  <>
                    <br />
                    {passoComErro.erro.hint}
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <span className="modal__nota">
            {resumo.pendentes > 0 && !rodando
              ? `${resumo.pendentes} comando(s) não chegaram a rodar`
              : ''}
          </span>

          {continuar && (
            <button className="btn btn--secondary" onClick={continuar}>
              Continuar do comando {(resumo.indiceDoErro ?? 0) + 2}
            </button>
          )}
          <button className="btn btn--primary" onClick={onFechar} disabled={rodando}>
            {rodando ? 'Executando…' : 'Fechar'}
          </button>
        </div>
      </div>
    </div>
  )
}
