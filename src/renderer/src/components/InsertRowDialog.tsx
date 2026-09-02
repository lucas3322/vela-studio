import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo } from '@shared/types'
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
  onInserir: (valores: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

interface Campo {
  valor: string
  nulo: boolean
}

/** Colunas que o banco preenche sozinho não vêm marcadas para digitação. */
function automatica(coluna: ColumnInfo): boolean {
  const extra = (coluna.extra ?? '').toLowerCase()
  return extra.includes('auto_increment') || extra.includes('identity') || extra.includes('generated')
}

export function InsertRowDialog({
  tabela,
  colunas,
  semSchema,
  avisoSemSchema,
  onInserir,
  onCancel
}: Props): React.JSX.Element {
  const [campos, setCampos] = useState<Record<string, Campo>>({})
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

  const obrigatoriaVazia = colunas.filter(
    (c) => !c.nullable && c.defaultValue == null && !automatica(c) && !(c.name in valores)
  )

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !gravando && onCancel()}
    >
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">Nova linha em {tabela}</div>
            <div className="modal__subtitle">
              Campo em branco não entra no comando — é assim que o banco aplica o valor padrão.
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
              const auto = automatica(coluna)
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
