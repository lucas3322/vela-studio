import { useEffect, useMemo, useState } from 'react'
import type {
  ColumnInfo,
  FormatoDeImportacao,
  MapeamentoDeColuna,
  OpcoesDeImportacao,
  PreviaDeImportacao,
  TipoDeduzido
} from '@shared/types'
import {
  aplicarRegraDeChaveAutomatica,
  casarColunas,
  colunaAutomatica,
  colunasObrigatoriasSemMapeamento,
  compatibilidade,
  normalizarNome,
  type VeredictoDeCompatibilidade
} from '../editor/importacao'
import { IconCheck, IconClose, IconKey, IconUpload, IconWarning } from './Icons'

const numero = new Intl.NumberFormat('pt-BR')

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function rotuloTipo(tipo: TipoDeduzido): string {
  switch (tipo) {
    case 'inteiro':
      return 'inteiro'
    case 'decimal':
      return 'decimal'
    case 'booleano':
      return 'booleano'
    case 'data':
      return 'data'
    case 'texto':
      return 'texto'
    case 'vazio':
      return 'sem dados'
  }
}

interface Props {
  tabela: string
  colunasDaTabela: ColumnInfo[]
  /** Bloqueia a importação inteira, com o motivo no rodapé. */
  motivoBloqueio?: string
  onFechar: () => void
  onExecutar: (params: {
    caminho: string
    formato: FormatoDeImportacao
    mapeamento: MapeamentoDeColuna[]
    opcoes: OpcoesDeImportacao
  }) => void
}

/**
 * Modal central de importação: escolher arquivo, conferir a prévia, remapear
 * coluna a coluna e decidir a chave auto-incremento — tudo antes de qualquer
 * linha entrar no banco.
 *
 * ## Por que a execução não acontece aqui dentro
 *
 * Ao confirmar, este componente só monta os parâmetros e chama `onExecutar` —
 * quem chama a IPC, acompanha o progresso e recarrega a tabela é o Sidebar,
 * porque o card de progresso do canto (`ProgressToast`) precisa sobreviver ao
 * fechamento deste modal. Se a chamada morasse aqui, fechar a janela no meio
 * (ou trocar de aba) cancelaria a importação sem ninguém pedir isso.
 */
export function ImportDialog({
  tabela,
  colunasDaTabela,
  motivoBloqueio,
  onFechar,
  onExecutar
}: Props): React.JSX.Element {
  const [previa, setPrevia] = useState<PreviaDeImportacao | undefined>(undefined)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [mapeamento, setMapeamento] = useState<MapeamentoDeColuna[]>([])
  const [ignorarPrimeiraLinha, setIgnorarPrimeiraLinha] = useState(false)
  const [usarIdsDoArquivo, setUsarIdsDoArquivo] = useState(false)
  const [confirmouComandosForaDeInsert, setConfirmouComandosForaDeInsert] = useState(false)

  /**
   * A prévia mostra o que **vai ser importado**, não as linhas cruas.
   *
   * Com o cabeçalho marcado, a primeira linha do arquivo é rótulo e não entra
   * no banco — mostrá-la junto dos dados fazia a pessoa conferir uma linha que
   * não existe como registro (e ver `id/nome/email` repetido como se fosse um
   * contato chamado "nome").
   */
  const linhasDeDados = useMemo(
    () => (ignorarPrimeiraLinha ? (previa?.linhas ?? []).slice(1) : (previa?.linhas ?? [])),
    [previa, ignorarPrimeiraLinha]
  )

  const escolherArquivo = async (): Promise<void> => {
    setErro(null)
    setCarregando(true)
    try {
      const resultado = await window.vela.app.importPreview({ linhas: 100 })
      if (!resultado) {
        setCarregando(false)
        return // seletor de arquivo cancelado
      }
      setPrevia(resultado)
      setConfirmouComandosForaDeInsert(false)
      if (resultado.formato === 'csv') {
        const automatico = casarColunas(resultado.colunas, colunasDaTabela)
        setMapeamento(
          aplicarRegraDeChaveAutomatica(automatico, resultado.colunas, colunasDaTabela, false)
        )
        setIgnorarPrimeiraLinha(resultado.temCabecalho ?? false)
        setUsarIdsDoArquivo(false)
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : 'Não foi possível ler o arquivo.')
    } finally {
      setCarregando(false)
    }
  }

  // Abre o seletor assim que a modal aparece — poupa um clique extra numa
  // janela que, sem arquivo escolhido, não tem mais nada para mostrar.
  useEffect(() => {
    void escolherArquivo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  const trocarDestino = (origem: number, destino: string): void => {
    setMapeamento((atual) =>
      atual.map((m) => (m.origem === origem ? { ...m, destino: destino === '' ? null : destino } : m))
    )
  }

  const alternarUsarIdsDoArquivo = (valor: boolean): void => {
    setUsarIdsDoArquivo(valor)
    if (!previa || previa.formato !== 'csv') return
    setMapeamento((atual) => aplicarRegraDeChaveAutomatica(atual, previa.colunas, colunasDaTabela, valor))
  }

  const chaveAutomatica = colunasDaTabela.find(colunaAutomatica)
  const arquivoTemColunaDeChave =
    previa?.formato === 'csv' && chaveAutomatica
      ? previa.colunas.some((c) => normalizarNome(c.nome) === normalizarNome(chaveAutomatica.name))
      : false

  const obrigatoriasSemMapear =
    previa?.formato === 'csv' ? colunasObrigatoriasSemMapeamento(colunasDaTabela, mapeamento) : []

  const outrosComandosSql = previa?.sql?.outros ?? []
  const precisaConfirmarSql = outrosComandosSql.length > 0

  const podeImportar =
    !!previa &&
    !motivoBloqueio &&
    (previa.formato === 'csv'
      ? obrigatoriasSemMapear.length === 0
      : !precisaConfirmarSql || confirmouComandosForaDeInsert)

  const confirmar = (): void => {
    if (!previa || !podeImportar) return
    onExecutar({
      caminho: previa.caminho,
      formato: previa.formato,
      mapeamento: previa.formato === 'csv' ? mapeamento : [],
      opcoes: {
        ignorarPrimeiraLinha,
        delimitador: previa.delimitador,
        usarIdsDoArquivo
      }
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Importar arquivo para {tabela}</div>
            <div className="modal__subtitle">
              {previa
                ? `${previa.caminho.split(/[/\\]/).pop()} · ${formatarTamanho(previa.tamanhoBytes)}`
                : 'Escolha um arquivo CSV ou um dump SQL de INSERT.'}
            </div>
          </div>
          <button className="icon-btn" onClick={onFechar}>
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          {motivoBloqueio && (
            <div className="update__estado update__estado--aviso">
              <IconWarning size={18} />
              <span>{motivoBloqueio}</span>
            </div>
          )}

          {carregando && (
            <div className="tree-empty">
              <span className="spinner" style={{ margin: '0 auto var(--space-2)' }} />
              <br />
              Lendo o arquivo…
            </div>
          )}

          {erro && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>{erro}</span>
            </div>
          )}

          {!previa && !carregando && (
            <button className="btn btn--secondary" onClick={() => void escolherArquivo()}>
              <IconUpload size={14} />
              Escolher arquivo…
            </button>
          )}

          {previa && previa.truncada && (
            <div className="update__estado">
              <IconWarning size={14} />
              <span>
                Mostrando só as primeiras {previa.formato === 'csv' ? previa.linhas.length : previa.sql?.primeiros.length}{' '}
                linhas — o arquivo continua depois disso. A prévia serve para conferir o formato, não
                é garantia do arquivo inteiro.
              </span>
            </div>
          )}

          {previa && previa.formato === 'csv' && (
            <>
              <div>
                <div className="field__label" style={{ marginBottom: 6 }}>
                  Prévia ({linhasDeDados.length} linha(s) de dado)
                </div>
                <div className="import-previa">
                  <table className="import-previa__tabela">
                    <thead>
                      <tr>
                        {previa.colunas.map((coluna) => (
                          <th key={coluna.indice}>
                            <div>{coluna.nome}</div>
                            <div className="import-previa__tipo">{rotuloTipo(coluna.tipoDeduzido)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {linhasDeDados.map((linha, indice) => (
                        <tr key={indice}>
                          {linha.map((valor, coluna) => (
                            <td key={coluna} className="selectable">
                              {valor === '' ? <span className="import-previa__vazio">—</span> : valor}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <div className="field__label" style={{ marginBottom: 6 }}>
                  Mapeamento de colunas
                </div>
                <div className="mapeamento">
                  {previa.colunas.map((colunaDoArquivo) => {
                    const linha = mapeamento.find((m) => m.origem === colunaDoArquivo.indice)
                    const destino = linha?.destino ?? null
                    const colunaDestino = destino
                      ? colunasDaTabela.find((c) => c.name === destino)
                      : undefined
                    const veredito =
                      destino && colunaDestino
                        ? compatibilidade(colunaDoArquivo.tipoDeduzido, colunaDestino.type)
                        : undefined
                    const ehChave = destino != null && destino === chaveAutomatica?.name

                    return (
                      <div className="mapeamento__linha" key={colunaDoArquivo.indice}>
                        <div className="mapeamento__origem">
                          <span className="mapeamento__nome">{colunaDoArquivo.nome}</span>
                          <span className="mapeamento__meta">
                            {rotuloTipo(colunaDoArquivo.tipoDeduzido)}
                            {colunaDoArquivo.exemplos.length > 0 &&
                              ` · ex.: ${colunaDoArquivo.exemplos.slice(0, 2).join(', ')}`}
                          </span>
                        </div>

                        <select
                          className="input mapeamento__select"
                          value={destino ?? ''}
                          onChange={(e) => trocarDestino(colunaDoArquivo.indice, e.target.value)}
                        >
                          <option value="">Ignorar esta coluna</option>
                          {colunasDaTabela.map((coluna) => (
                            <option key={coluna.name} value={coluna.name}>
                              {coluna.name}
                              {colunaAutomatica(coluna) ? ' (auto)' : ''}
                            </option>
                          ))}
                        </select>

                        <div className="mapeamento__selo">
                          {ehChave && (
                            <span className="selo selo--info" title="Chave auto-incremento: usando os IDs do arquivo">
                              <IconKey size={11} />
                              chave
                            </span>
                          )}
                          {veredito && <Selo veredito={veredito.veredito} motivo={veredito.motivo} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {arquivoTemColunaDeChave && chaveAutomatica && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={usarIdsDoArquivo}
                    onChange={(e) => alternarUsarIdsDoArquivo(e.target.checked)}
                  />
                  <span>
                    Usar os IDs do arquivo em <code>{chaveAutomatica.name}</code>, em vez de deixar o
                    banco gerar
                  </span>
                </label>
              )}
              {usarIdsDoArquivo && (
                <div className="update__estado update__estado--aviso">
                  <IconWarning size={14} />
                  <span>
                    Um id que já existe na tabela é recusado. No PostgreSQL, a sequência do
                    auto-incremento não avança sozinha com id explícito — o próximo INSERT do
                    sistema pode colidir bem depois desta importação. A IDE reajusta a sequência
                    ao final, se este banco for PostgreSQL.
                  </span>
                </div>
              )}

              {previa.temCabecalho != null && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={ignorarPrimeiraLinha}
                    onChange={(e) => setIgnorarPrimeiraLinha(e.target.checked)}
                  />
                  <span>A primeira linha do arquivo é cabeçalho, não dado</span>
                </label>
              )}

              {obrigatoriasSemMapear.length > 0 && (
                <div className="editor-celula__erro">
                  <IconWarning size={14} />
                  <span>
                    Sem valor e sem padrão:{' '}
                    <strong>{obrigatoriasSemMapear.map((c) => c.name).join(', ')}</strong>. Mapeie uma
                    coluna do arquivo para elas, ou o banco vai recusar a linha.
                  </span>
                </div>
              )}
            </>
          )}

          {previa && previa.formato === 'sql' && previa.sql && (
            <>
              <div className="update__estado">
                <IconWarning size={14} />
                <span>
                  {numero.format(previa.sql.comandos)} comando(s) na prévia, sendo{' '}
                  {numero.format(previa.sql.inserts)} <code>INSERT</code>. Um dump SQL executa
                  comando arbitrário no banco — confira antes de rodar.
                </span>
              </div>

              {precisaConfirmarSql && (
                <div>
                  <div className="field__label" style={{ marginBottom: 6 }}>
                    Comandos que NÃO são INSERT
                  </div>
                  <pre className="update__notas selectable">{outrosComandosSql.join('\n\n')}</pre>
                </div>
              )}

              <div>
                <div className="field__label" style={{ marginBottom: 6 }}>
                  Primeiros comandos do arquivo
                </div>
                <pre className="update__notas selectable">{previa.sql.primeiros.join('\n\n')}</pre>
              </div>

              {precisaConfirmarSql && !motivoBloqueio && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={confirmouComandosForaDeInsert}
                    onChange={(e) => setConfirmouComandosForaDeInsert(e.target.checked)}
                  />
                  <span>
                    Entendo que os comandos acima não são <code>INSERT</code> e serão executados
                    exatamente como estão no arquivo
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div className="modal__footer">
          <span className="modal__nota">
            {previa?.formato === 'csv' &&
              mapeamento.filter((m) => m.destino != null).length > 0 &&
              `${mapeamento.filter((m) => m.destino != null).length} coluna(s) mapeada(s)`}
          </span>
          <button className="btn btn--secondary" onClick={onFechar}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={confirmar} disabled={!podeImportar}>
            <IconCheck size={14} />
            Importar
          </button>
        </div>
      </div>
    </div>
  )
}

function Selo({
  veredito,
  motivo
}: {
  veredito: VeredictoDeCompatibilidade
  motivo: string
}): React.JSX.Element {
  const texto =
    veredito === 'compativel' ? 'compatível' : veredito === 'convertivel' ? 'convertível' : 'incompatível'
  return (
    <span className={`selo selo--${veredito}`} title={motivo}>
      {veredito === 'compativel' && <IconCheck size={11} />}
      {veredito === 'incompativel' && <IconWarning size={11} />}
      {texto}
    </span>
  )
}
