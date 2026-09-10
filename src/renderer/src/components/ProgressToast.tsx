import { useState } from 'react'
import type { ResultadoDaImportacao } from '@shared/types'
import { useAppStore } from '../store/app'
import { IconCheck, IconClose, IconFolder, IconWarning } from './Icons'

const numero = new Intl.NumberFormat('pt-BR')

/** Só o nome do arquivo, sem o caminho — o card não é largo o bastante para o caminho inteiro. */
function nomeDe(caminho: string): string {
  return caminho.split(/[/\\]/).pop() ?? caminho
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Card de progresso no canto inferior direito — exportação e importação de
 * arquivo passam por aqui.
 *
 * ## Mesmo lugar, mesmo vocabulário do aviso de versão
 *
 * `position: fixed` no mesmo canto, mesma largura, mesma superfície elevada:
 * é o card que o usuário já reconhece como "notificação que fica até eu
 * responder", em vez de inventar um terceiro padrão de card na tela.
 *
 * ## Por que a % só aparece quando é honesta
 *
 * A exportação em fluxo não sabe de antemão quantas linhas o banco vai
 * devolver — só quem chamou (a árvore lateral, com a contagem do catálogo)
 * tem uma estimativa, e mesmo essa pode estar desatualizada. Sem ela, o card
 * mostra o indeterminado (giro contínuo, o mesmo spinner usado em toda leitura
 * de schema) e só o número de linhas já gravadas — nunca uma porcentagem
 * inventada. A importação tem uma medida real, os bytes do arquivo, então ali
 * a % sempre aparece.
 */
export function ProgressToast(): React.JSX.Element | null {
  const tarefa = useAppStore((s) => s.tarefa)
  const fecharTarefa = useAppStore((s) => s.fecharTarefa)
  const [saindo, setSaindo] = useState(false)

  if (!tarefa) return null

  const fechar = (): void => {
    setSaindo(true)
    // Deixa a animação de saída terminar antes de desmontar — ver a mesma
    // nota em `UpdateBanner`.
    setTimeout(() => {
      fecharTarefa()
      setSaindo(false)
    }, 180)
  }

  const titulo =
    tarefa.tipo === 'exportacao'
      ? tarefa.estado === 'rodando'
        ? `Exportando ${tarefa.rotulo}…`
        : tarefa.estado === 'erro'
          ? 'Falha ao exportar'
          : 'Exportação concluída'
      : tarefa.estado === 'rodando'
        ? `Importando para ${tarefa.rotulo}…`
        : tarefa.estado === 'erro'
          ? 'Falha ao importar'
          : 'Importação concluída'

  const percentual =
    tarefa.tipo === 'exportacao'
      ? tarefa.totalEstimado && tarefa.totalEstimado > 0
        ? Math.min(100, Math.round((tarefa.linhas / tarefa.totalEstimado) * 100))
        : undefined
      : tarefa.bytesTotais > 0
        ? Math.min(100, Math.round((tarefa.bytesLidos / tarefa.bytesTotais) * 100))
        : undefined

  return (
    <div className={`progresso-toast ${saindo ? 'progresso-toast--saindo' : ''}`} role="status">
      <button className="progresso-toast__fechar" onClick={fechar} title="Fechar" aria-label="Fechar">
        <IconClose size={13} />
      </button>

      <div className="progresso-toast__cabecalho">
        <span
          className={`progresso-toast__marca progresso-toast__marca--${tarefa.estado}`}
          aria-hidden="true"
        >
          {tarefa.estado === 'rodando' && <span className="spinner" />}
          {tarefa.estado === 'concluido' && <IconCheck size={14} />}
          {tarefa.estado === 'erro' && <IconWarning size={14} />}
        </span>
        <span className="progresso-toast__titulo">{titulo}</span>
      </div>

      {tarefa.estado !== 'erro' && (
        <div className="progresso-toast__progresso">
          {percentual != null ? (
            <>
              <div className="progresso-toast__barra">
                <div className="progresso-toast__barra-preenchida" style={{ width: `${percentual}%` }} />
              </div>
              <div className="progresso-toast__medida">
                {tarefa.tipo === 'exportacao'
                  ? `${percentual}% (estimativa) · ${numero.format(tarefa.linhas)} linha(s)`
                  : `${percentual}% · ${formatarBytes(tarefa.bytesLidos)} de ${formatarBytes(tarefa.bytesTotais)}`}
              </div>
            </>
          ) : (
            <div className="progresso-toast__medida">
              {tarefa.tipo === 'exportacao'
                ? `${numero.format(tarefa.linhas)} linha(s) gravada(s)${tarefa.arquivos > 1 ? ` em ${tarefa.arquivos} arquivos` : ''}`
                : `${numero.format(tarefa.lidas)} linha(s) lida(s)`}
            </div>
          )}
        </div>
      )}

      {tarefa.estado === 'erro' && (
        <div className="progresso-toast__erro">
          <span>{tarefa.mensagemDeErro}</span>
        </div>
      )}

      {tarefa.tipo === 'exportacao' && tarefa.estado === 'concluido' && (
        <div className="progresso-toast__rodape">
          <span className="progresso-toast__resumo">
            {numero.format(tarefa.linhas)} linha(s) em {tarefa.arquivosGerados?.length ?? 0} arquivo(s)
          </span>
          {tarefa.arquivosGerados && tarefa.arquivosGerados.length > 0 && (
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => void window.vela.app.revealInFolder(tarefa.arquivosGerados![0])}
              title={`Mostrar ${nomeDe(tarefa.arquivosGerados[0])} na pasta`}
            >
              <IconFolder size={13} />
              Mostrar na pasta
            </button>
          )}
        </div>
      )}

      {tarefa.tipo === 'importacao' && tarefa.estado === 'concluido' && tarefa.resultado && (
        <ResultadoDaImportacaoResumo resultado={tarefa.resultado} />
      )}
    </div>
  )
}

function ResultadoDaImportacaoResumo({
  resultado
}: {
  resultado: ResultadoDaImportacao
}): React.JSX.Element {
  const { linhasLidas, linhasGravadas, falhas, falhasOmitidas, sequenciaReajustada } = resultado
  const comFalha = falhas.length > 0

  return (
    <div className="progresso-toast__rodape progresso-toast__rodape--coluna">
      <span className="progresso-toast__resumo">
        {numero.format(linhasGravadas)} de {numero.format(linhasLidas)} linha(s) gravada(s)
        {comFalha ? ` — ${numero.format(falhas.length + falhasOmitidas)} falharam` : ''}
      </span>

      {sequenciaReajustada && (
        <span className="progresso-toast__nota">
          Sequência <code>{sequenciaReajustada}</code> reajustada para os ids do arquivo.
        </span>
      )}

      {comFalha && (
        <div className="progresso-toast__falhas">
          {falhas.map((falha) => (
            <div key={falha.linha} className="progresso-toast__falha">
              <strong>Linha {falha.linha}:</strong> {falha.motivo}
            </div>
          ))}
          {falhasOmitidas > 0 && (
            <div className="progresso-toast__falha progresso-toast__falha--omitidas">
              +{numero.format(falhasOmitidas)} falha(s) não mostrada(s)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
