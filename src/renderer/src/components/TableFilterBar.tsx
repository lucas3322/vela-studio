import { useState } from 'react'
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
  disabled
}: Props): React.JSX.Element {
  const [condicoes, setCondicoes] = useState<Condicao[]>([{ ...VAZIA }])

  const trocar = (indice: number, patch: Partial<Condicao>): void => {
    setCondicoes((atuais) => atuais.map((c, i) => (i === indice ? { ...c, ...patch } : c)))
  }

  const prontas = condicoes.filter(condicaoUsavel)
  const previa =
    prontas.length === 0
      ? ''
      : dialect === 'mongodb'
        ? montarFiltroMongo(prontas)
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
            onChange={(e) => trocar(indice, { coluna: e.target.value })}
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
