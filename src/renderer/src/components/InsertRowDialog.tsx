import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo } from '@shared/types'
import { colunaAutomatica } from '../editor/importacao'
import { IconCheck, IconClose, IconKey, IconWarning } from './Icons'

/**
 * Formulário de nova linha.
 *
 * ## Por que um campo por coluna, e não uma linha em branco na grade
 *
 * A grade tem a largura da coluna e uma linha de altura, e inserir é o momento
 * em que **todas** as colunas precisam ser vistas de uma vez: quais aceitam
 * nulo, quais têm padrão, qual é a chave. Numa tabela de 84 colunas, preencher
 * rolando a grade para o lado é adivinhação.
 *
 * ## Campo em branco não é o mesmo que NULL
 *
 * Esta é a distinção que decide se a inserção funciona. Coluna deixada em
 * branco **não entra no INSERT**: é assim que o banco aplica o `DEFAULT` e o
 * auto-incremento. Mandar `NULL` numa coluna auto-incremento funciona por
 * acaso no MySQL e falha no PostgreSQL — e mandar `NULL` numa coluna com
 * `DEFAULT CURRENT_TIMESTAMP` grava nulo em vez da data.
 *
 * Quem quer nulo de verdade marca a caixa `NULL`, que é explícita e visível.
 */

interface Props {
  tabela: string
  colunas: ColumnInfo[]
  /** MongoDB e Redis não têm schema fixo declarado no catálogo. */
  semSchema?: boolean
  /**
   * Texto do aviso mostrado quando `semSchema` é `true`.
   *
   * Varia por driver: o Mongo não tem nenhuma coluna garantida, mas o Redis
   * tem exatamente três (`key`, `value`, `ttl`) sempre — dizer a mesma frase
   * do Mongo para o Redis seria uma afirmação falsa sobre o schema dele.
   */
  avisoSemSchema?: string
  /**
   * Valores que o formulário já nasce preenchido — é a duplicação de linha.
   *
   * A chave auto-incremento é deixada de fora de propósito, mesmo vindo aqui:
   * copiar o id da linha original garantiria conflito de chave. Em branco, o
   * banco gera o próximo, que é o que "duplicar" quer dizer.
   */
  valoresIniciais?: Record<string, unknown>
  /**
   * Colunas com índice único, para avisar na duplicação.
   *
   * Uma cópia fiel de uma linha colide em qualquer coluna única, e o banco
   * responde com um erro de chave duplicada que não diz qual coluna foi. Aqui
   * dá para apontar antes de tentar.
   */
  colunasUnicas?: string[]
  onInserir: (valores: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

interface Campo {
  valor: string
  nulo: boolean
}

export function InsertRowDialog({
  tabela,
  colunas,
  semSchema,
  avisoSemSchema,
  valoresIniciais,
  colunasUnicas,
  onInserir,
  onCancel
}: Props): React.JSX.Element {
  const duplicando = valoresIniciais !== undefined

  const [campos, setCampos] = useState<Record<string, Campo>>(() => {
    if (!valoresIniciais) return {}

    const inicial: Record<string, Campo> = {}
    for (const coluna of colunas) {
      // A chave auto-incremento fica de fora: copiá-la garantiria conflito.
      if (colunaAutomatica(coluna)) continue

      const valor = valoresIniciais[coluna.name]
      if (valor === undefined) continue
      if (valor === null) {
        inicial[coluna.name] = { valor: '', nulo: true }
        continue
      }
      // Objeto (coluna JSON) tem que virar texto, senão o campo mostraria
      // "[object Object]" — o mesmo engano que a edição de célula já pagou.
      inicial[coluna.name] = {
        valor: typeof valor === 'object' ? JSON.stringify(valor) : String(valor),
        nulo: false
      }
    }
    return inicial
  })
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape' && !gravando) onCancel()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onCancel, gravando])

  const trocar = (nome: string, patch: Partial<Campo>): void => {
    setErro(null)
    setCampos((atuais) => ({
      ...atuais,
      [nome]: { ...(atuais[nome] ?? { valor: '', nulo: false }), ...patch }
    }))
  }

  /** Só o que a pessoa realmente preencheu ou marcou como nulo. */
  const valores = useMemo(() => {
    const saida: Record<string, unknown> = {}
    for (const [nome, campo] of Object.entries(campos)) {
      if (campo.nulo) saida[nome] = null
      else if (campo.valor !== '') saida[nome] = campo.valor
    }
    return saida
  }, [campos])

  const quantos = Object.keys(valores).length

  const confirmar = async (): Promise<void> => {
    if (quantos === 0 || gravando) return
    setGravando(true)
    setErro(null)
    try {
      await onInserir(valores)
    } catch (falha) {
      setErro((falha as Error).message)
      setGravando(false)
    }
  }

  /**
   * Colunas únicas que seguem com o valor copiado da linha original.
   *
   * Some da lista assim que a pessoa muda o valor — o aviso existe para ser
   * resolvido, não para ficar piscando depois de já ter sido atendido.
   */
  const unicasRepetidas = (colunasUnicas ?? []).filter((nome) => {
    const original = valoresIniciais?.[nome]
    if (original === undefined || original === null) return false
    const atual = valores[nome]
    if (atual === undefined || atual === null) return false
    const comoTexto = typeof original === 'object' ? JSON.stringify(original) : String(original)
    return String(atual) === comoTexto
  })

  const obrigatoriaVazia = colunas.filter(
    (c) => !c.nullable && c.defaultValue == null && !colunaAutomatica(c) && !(c.name in valores)
  )

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !gravando && onCancel()}
    >
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {duplicando ? `Duplicar linha em ${tabela}` : `Nova linha em ${tabela}`}
            </div>
            <div className="modal__subtitle">
              {duplicando
                ? 'Os valores vieram da linha original. A chave automática ficou em branco para o banco gerar uma nova.'
                : 'Campo em branco não entra no comando — é assim que o banco aplica o valor padrão.'}
            </div>
          </div>
          <button className="icon-btn" onClick={onCancel} disabled={gravando}>
            <IconClose />
          </button>
        </div>

        <div className="modal__body">
          {semSchema && (
            <div className="modelo__nota">
              <IconWarning size={14} />
              <span>
                {avisoSemSchema ??
                  'O MongoDB não declara schema. Os campos abaixo vieram de uma amostra dos documentos — o novo documento nasce com exatamente o que você preencher.'}
              </span>
            </div>
          )}

          <div className="insercao">
            {colunas.map((coluna) => {
              const campo = campos[coluna.name]
              const auto = colunaAutomatica(coluna)
              return (
                <label className="insercao__linha" key={coluna.name}>
                  <span className="insercao__rotulo">
                    {coluna.isPrimaryKey && <IconKey size={11} />}
                    {coluna.name}
                    <span className="insercao__tipo">{coluna.type}</span>
                  </span>

                  <input
                    className="input insercao__valor"
                    value={campo?.nulo ? '' : (campo?.valor ?? '')}
                    disabled={gravando || campo?.nulo}
                    placeholder={
                      auto
                        ? 'auto-incremento'
                        : coluna.defaultValue != null
                          ? `padrão: ${coluna.defaultValue}`
                          : coluna.nullable
                            ? 'NULL'
                            : 'obrigatório'
                    }
                    onChange={(e) => trocar(coluna.name, { valor: e.target.value, nulo: false })}
                  />

                  {/*
                    A caixa de NULL existe porque branco e nulo são coisas
                    diferentes aqui: branco deixa o banco decidir, nulo grava
                    nulo. Sem ela não haveria como pedir nulo numa coluna que
                    tem DEFAULT.
                  */}
                  <label
                    className={`checkbox insercao__nulo ${!coluna.nullable ? 'insercao__nulo--indisponivel' : ''}`}
                    title={
                      coluna.nullable
                        ? 'Gravar NULL nesta coluna'
                        : 'Esta coluna não aceita NULL'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={campo?.nulo ?? false}
                      disabled={gravando || !coluna.nullable}
                      onChange={(e) => trocar(coluna.name, { nulo: e.target.checked, valor: '' })}
                    />
                    <span>NULL</span>
                  </label>
                </label>
              )
            })}
          </div>

          {duplicando && unicasRepetidas.length > 0 && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>
                Índice único em <strong>{unicasRepetidas.join(', ')}</strong>, com o mesmo valor da
                linha original. O banco vai recusar a cópia — altere antes de inserir.
              </span>
            </div>
          )}

          {obrigatoriaVazia.length > 0 && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>
                Sem valor e sem padrão: <strong>{obrigatoriaVazia.map((c) => c.name).join(', ')}</strong>
                . O banco vai recusar se continuarem em branco.
              </span>
            </div>
          )}

          {erro && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <span className="modal__nota">
            {quantos === 0
              ? 'Preencha ao menos uma coluna'
              : `${quantos} coluna(s) no comando; o resto fica com o padrão do banco`}
          </span>
          <button className="btn btn--secondary" onClick={onCancel} disabled={gravando}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void confirmar()}
            disabled={quantos === 0 || gravando}
          >
            <IconCheck size={14} />
            {gravando ? 'Inserindo…' : 'Inserir'}
          </button>
        </div>
      </div>
    </div>
  )
}
