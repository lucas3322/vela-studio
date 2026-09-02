import { useMemo, useState } from 'react'
import type { ColumnInfo, Dialect } from '@shared/types'
import {
  OPERADORES,
  montarFiltroMongo,
  montarWhere,
  operadorTemValor,
  condicaoUsavel,
  type Condicao
} from '../editor/filter-builder'
import { IconClose, IconPlus, IconSearch } from './Icons'

interface Props {
  columns: ColumnInfo[]
  dialect: Dialect
  /** Filtro em vigor, para o botão saber se há algo a limpar. */
  aplicado: Condicao[]
  onAplicar: (condicoes: Condicao[]) => void
  /** Avisa qual coluna acabou de ser escolhida, para a grade rolar até ela. */
  onColunaEscolhida?: (coluna: string) => void
  disabled?: boolean
}

const VAZIA: Condicao = { coluna: '', operador: 'igual', valor: '' }

/**
 * Filtro sem escrever SQL.
 *
 * A tese do produto é que a IDE conhece o schema e usa isso para quem está
 * aprendendo. Aqui isso vira: escolher a coluna numa lista, o operador em
 * português, digitar o valor — e **ver o SQL que aquilo gerou**. Quem não
 * escreve SQL filtra; quem quer aprender lê a cláusula que acabou de montar.
 *
 * Só `AND` entre as condições, de propósito: oferecer `OR` sem parênteses
 * produziria `a AND b OR c`, que não é o que a interface aparenta dizer.
 */
export function TableFilterBar({
  columns,
  dialect,
  aplicado,
  onAplicar,
  onColunaEscolhida,
  disabled
}: Props): React.JSX.Element {
  if (dialect === 'redis') return <FiltroDeChaveRedis aplicado={aplicado} onAplicar={onAplicar} disabled={disabled} />

  return (
    <FiltroPorCondicoes
      columns={columns}
      dialect={dialect}
      aplicado={aplicado}
      onAplicar={onAplicar}
      onColunaEscolhida={onColunaEscolhida}
      disabled={disabled}
    />
  )
}

/**
 * Filtro do Redis: um padrão glob sobre a chave, não um construtor de
 * condições por coluna.
 *
 * O Redis não tem índice secundário — `SCAN MATCH` é a única forma de
 * restringir quais chaves voltam, e ela só enxerga o nome da chave, nunca o
 * valor guardado nela. Reaproveita `Condicao[]` só para não mexer no
 * contrato entre `TableView` e a barra: a condição sempre tem `coluna: 'key'`
 * e `operador: 'igual'`, e é o `valor` que carrega o padrão glob.
 */
function FiltroDeChaveRedis({
  aplicado,
  onAplicar,
  disabled
}: Pick<Props, 'aplicado' | 'onAplicar' | 'disabled'>): React.JSX.Element {
  const [padrao, setPadrao] = useState(aplicado[0]?.valor ?? '')

  const aplicar = (): void => {
    onAplicar(padrao.trim() ? [{ coluna: 'key', operador: 'igual', valor: padrao.trim() }] : [])
  }

  const limpar = (): void => {
    setPadrao('')
    onAplicar([])
  }

  return (
    <div className="filtro">
      <div className="filtro__linha">
        <span className="filtro__juncao">chave</span>
        <input
          className="input filtro__valor"
          value={padrao}
          disabled={disabled}
          placeholder="user:* (padrão glob do SCAN MATCH)"
          onChange={(e) => setPadrao(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && aplicar()}
          aria-label="Padrão da chave"
        />
        <span className="filtro__acoes">
          <button
            className="btn btn--primary btn--sm"
            onClick={aplicar}
            disabled={disabled}
            title="Aplicar o filtro (Enter)"
          >
            <IconSearch size={13} />
            Filtrar
          </button>
          {aplicado.length > 0 && (
            <button className="btn btn--secondary btn--sm" onClick={limpar} disabled={disabled}>
              Limpar
            </button>
          )}
        </span>
      </div>
      <code className="filtro__previa" title="Trecho que será acrescentado ao comando SCAN">
        MATCH {padrao.trim() || '*'}
      </code>
    </div>
  )
}

function FiltroPorCondicoes({
  columns,
  dialect,
  aplicado,
  onAplicar,
  onColunaEscolhida,
  disabled
}: Props): React.JSX.Element {
  const [condicoes, setCondicoes] = useState<Condicao[]>([{ ...VAZIA }])

  const trocar = (indice: number, patch: Partial<Condicao>): void => {
    setCondicoes((atuais) => atuais.map((c, i) => (i === indice ? { ...c, ...patch } : c)))
  }

  const prontas = condicoes.filter(condicaoUsavel)

  /*
    O tipo de cada campo, vindo do schema. No Mongo isso decide se o valor vai
    como texto ou como número — a igualdade lá é tipada, e procurar um MSISDN
    de texto usando número devolve zero documento sem reclamar de nada.
  */
  const tiposPorCampo = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.name, c.type])),
    [columns]
  )
  const previa =
    prontas.length === 0
      ? ''
      : dialect === 'mongodb'
        ? montarFiltroMongo(prontas, tiposPorCampo)
        : montarWhere(prontas, dialect)

  const aplicar = (): void => onAplicar(prontas)

  const limpar = (): void => {
    setCondicoes([{ ...VAZIA }])
    onAplicar([])
  }

  return (
    <div className="filtro">
      {condicoes.map((condicao, indice) => (
        <div className="filtro__linha" key={indice}>
          <span className="filtro__juncao">{indice === 0 ? 'onde' : 'e'}</span>

          <select
            className="input filtro__coluna"
            value={condicao.coluna}
            disabled={disabled}
            onChange={(e) => {
              trocar(indice, { coluna: e.target.value })
              // Rola a grade até ela: numa tabela larga, escolher um campo que
              // está fora da tela deixava a pessoa sem ver o que escolheu.
              if (e.target.value) onColunaEscolhida?.(e.target.value)
            }}
            aria-label="Coluna"
          >
            <option value="">escolha a coluna…</option>
            {columns.map((coluna) => (
              <option key={coluna.name} value={coluna.name}>
                {coluna.name}
              </option>
            ))}
          </select>

          <select
            className="input filtro__operador"
            value={condicao.operador}
            disabled={disabled}
            onChange={(e) => trocar(indice, { operador: e.target.value as Condicao['operador'] })}
            aria-label="Comparação"
          >
            {OPERADORES.map((op) => (
              <option key={op.id} value={op.id}>
                {op.rotulo}
              </option>
            ))}
          </select>

          <input
            className="input filtro__valor"
            value={condicao.valor}
            disabled={disabled || !operadorTemValor(condicao.operador)}
            placeholder={operadorTemValor(condicao.operador) ? 'valor' : '—'}
            onChange={(e) => trocar(indice, { valor: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && aplicar()}
            aria-label="Valor"
          />

          {condicoes.length > 1 && (
            <button
              className="icon-btn"
              onClick={() => setCondicoes((a) => a.filter((_, i) => i !== indice))}
              title="Remover esta condição"
              aria-label="Remover esta condição"
            >
              <IconClose size={13} />
            </button>
          )}

          {indice === condicoes.length - 1 && (
            <button
              className="icon-btn"
              onClick={() => setCondicoes((a) => [...a, { ...VAZIA }])}
              title="Adicionar outra condição"
              aria-label="Adicionar outra condição"
              disabled={disabled}
            >
              <IconPlus size={13} />
            </button>
          )}

          {indice === 0 && (
            <span className="filtro__acoes">
              <button
                className="btn btn--primary btn--sm"
                onClick={aplicar}
                disabled={disabled}
                title="Aplicar o filtro (Enter)"
              >
                <IconSearch size={13} />
                Filtrar
              </button>
              {aplicado.length > 0 && (
                <button className="btn btn--secondary btn--sm" onClick={limpar} disabled={disabled}>
                  Limpar
                </button>
              )}
            </span>
          )}
        </div>
      ))}

      {/*
        O SQL gerado fica à vista. É o que transforma o filtro em aprendizado
        em vez de caixa-preta — e é também como a pessoa confere o que vai
        rodar, já que o valor digitado é escapado, não parametrizado.
      */}
      {previa && (
        <code className="filtro__previa" title="Trecho que será acrescentado à consulta">
          {previa}
        </code>
      )}
    </div>
  )
}
