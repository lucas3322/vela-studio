import { useCallback, useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress } from '@shared/types'
import { useAppStore } from '../store/app'
import { IconCheck, IconClose, IconDownload, IconRefresh, IconWarning } from './Icons'

type Fase = 'checando' | 'pronto' | 'baixando' | 'baixado'

/**
 * Checagem e download de atualização.
 *
 * O passo final é humano de propósito — arrastar para Aplicativos no macOS,
 * seguir o instalador no Windows. Trocar o app sozinho exigiria assinatura de
 * Developer ID; sem ela a substituição falharia *depois* do download, e o
 * usuário ficaria sem app e sem explicação. Ver src/main/updater.ts.
 */
export function UpdateModal(): React.JSX.Element {
  const closeModal = useAppStore((s) => s.closeModal)
  const notify = useAppStore((s) => s.notify)

  const [fase, setFase] = useState<Fase>('checando')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [progresso, setProgresso] = useState<UpdateProgress | null>(null)
  const [falhaDoDownload, setFalhaDoDownload] = useState<string | null>(null)

  const checar = useCallback(async () => {
    setFase('checando')
    setFalhaDoDownload(null)
    setInfo(await window.vela.update.check())
    setFase('pronto')
  }, [])

  useEffect(() => {
    void checar()
  }, [checar])

  useEffect(() => {
    return window.velaEvents.on('app:updateProgress', ((p: UpdateProgress) =>
      setProgresso(p)) as never)
  }, [])

  const baixar = async (): Promise<void> => {
    setFase('baixando')
    setProgresso(null)
    setFalhaDoDownload(null)
    try {
      await window.vela.update.download()
      setFase('baixado')
    } catch (error) {
      setFase('pronto')
      setFalhaDoDownload((error as Error).message)
    }
  }

  const abrirPagina = (): void => {
    void window.vela.update.openPage()
    notify('Abri a página da release no navegador.', 'info')
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Atualizações</div>
            <div className="modal__subtitle">
              Você está na versão <strong>{__APP_VERSION__}</strong>
            </div>
          </div>
          <button className="icon-btn" onClick={closeModal} title="Fechar">
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          {fase === 'checando' && (
            <div className="update__estado">
              <span className="spinner" />
              Procurando versões novas…
            </div>
          )}

          {fase === 'pronto' && info?.status === 'atual' && (
            <div className="update__estado update__estado--ok">
              <IconCheck size={18} />
              Você já está na versão mais recente.
            </div>
          )}

          {fase === 'pronto' && info?.status === 'erro' && (
            <div className="update__estado update__estado--aviso">
              <IconWarning size={18} />
              {info.mensagem}
            </div>
          )}

          {fase === 'pronto' && info?.status === 'sem-arquivo' && (
            <>
              <div className="update__estado update__estado--aviso">
                <IconWarning size={18} />
                {info.mensagem}
              </div>
              <p className="update__nota">
                Não vou oferecer o instalador de outra arquitetura: um pacote com o binário errado
                dentro instala, abre e falha dizendo que o app está danificado. Veja na página da
                release se apareceu algum arquivo depois.
              </p>
            </>
          )}

          {(fase !== 'checando' && (info?.status === 'disponivel' || fase === 'baixado')) && info && (
            <>
              <div className="update__versao">
                <div>
                  <div className="update__versao-num">Versão {info.versaoNova}</div>
                  <div className="update__versao-meta">
                    {info.publicadoEm && formatarData(info.publicadoEm)}
                    {info.tamanhoBytes ? ` · ${formatarTamanho(info.tamanhoBytes)}` : ''}
                  </div>
                </div>
                <span className="badge">nova</span>
              </div>

              {info.notas && <pre className="update__notas">{info.notas}</pre>}

              {fase === 'baixando' && (
                <div className="update__progresso">
                  <div className="update__barra">
                    <div
                      className="update__barra-preenchida"
                      style={{ width: `${percentual(progresso)}%` }}
                    />
                  </div>
                  <div className="update__versao-meta">
                    {progresso
                      ? `${formatarTamanho(progresso.recebidoBytes)} de ${formatarTamanho(progresso.totalBytes)}`
                      : 'Iniciando o download…'}
                  </div>
                </div>
              )}

              {fase === 'baixado' && (
                <div className="update__estado update__estado--ok">
                  <IconCheck size={18} />
                  <div>
                    Baixado em <strong>Downloads</strong> e aberto.
                    <br />
                    <span className="update__nota">
                      {window.vela.app.platform === 'darwin'
                        ? 'Arraste o Vela Studio para a pasta Aplicativos, substituindo o atual. Feche este app antes.'
                        : 'Siga o instalador para concluir. Feche este app antes.'}
                    </span>
                  </div>
                </div>
              )}

              {falhaDoDownload && (
                <div className="update__estado update__estado--aviso">
                  <IconWarning size={18} />
                  {falhaDoDownload}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal__footer">
          {info?.paginaUrl && (
            <button className="btn btn--ghost modal__footer-left" onClick={abrirPagina}>
              Ver no GitHub
            </button>
          )}
          <button className="btn btn--secondary" onClick={() => void checar()} disabled={fase === 'baixando'}>
            <IconRefresh size={14} />
            Verificar de novo
          </button>
          {info?.status === 'disponivel' && fase !== 'baixado' && (
            <button className="btn btn--primary" onClick={() => void baixar()} disabled={fase === 'baixando'}>
              <IconDownload size={14} />
              {fase === 'baixando' ? 'Baixando…' : 'Baixar e abrir'}
            </button>
          )}
          {(info?.status !== 'disponivel' || fase === 'baixado') && (
            <button className="btn btn--primary" onClick={closeModal}>
              Fechar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function percentual(progresso: UpdateProgress | null): number {
  // Sem content-length não dá para calcular; a barra fica no início em vez de
  // mostrar uma porcentagem inventada.
  if (!progresso?.totalBytes) return 0
  return Math.min(100, Math.round((progresso.recebidoBytes / progresso.totalBytes) * 100))
}

function formatarTamanho(bytes: number): string {
  if (!bytes) return '—'
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}
