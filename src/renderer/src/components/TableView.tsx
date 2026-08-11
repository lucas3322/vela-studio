import { useEffect, useState } from 'react'
import { DRIVERS, type ColumnInfo, type IndexInfo, type RelationInfo } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore, type Tab } from '../store/tabs'
import { EditableGrid, type OrdenacaoDaGrade } from './EditableGrid'
import { ErrorPanel } from './ErrorPanel'
import { IconKey, IconLink } from './Icons'

type Panel = 'dados' | 'colunas' | 'indices' | 'relacoes'

/**
 * Aba de tabela: os dados de um lado, a estrutura do outro.
 * Abrir uma tabela roda um SELECT limitado automaticamente — é o gesto
 * que todo mundo faz manualmente ao clicar numa tabela.
 */
export function TableView({ tab }: { tab: Tab }): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>(tab.initialPanel ?? 'dados')
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [relations, setRelations] = useState<RelationInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [ordem, setOrdem] = useState<OrdenacaoDaGrade | null>(null)
  const [pagina, setPagina] = useState(0)
  const [tamanhoPagina, setTamanhoPagina] = useState(TAMANHOS_DE_PAGINA[0])
  const [temProxima, setTemProxima] = useState(false)
  /**
   * Coluna que ancora a paginação quando o usuário não escolheu ordem.
   *
   * Guardada como string, não como o array de colunas: `columns` ganha
   * referência nova a cada carga e, estando nas dependências do efeito,
   * dispararia o efeito de novo em laço infinito. Uma string igual não
   * re-renderiza.
   */
  const [chaveDeOrdem, setChaveDeOrdem] = useState<string | null>(null)

  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const updateTab = useTabStore((s) => s.updateTab)
  const notify = useAppStore((s) => s.notify)

  const table = tab.table!
  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'

  useEffect(() => {
    if (!connectionId) return
    let cancelled = false
    setLoading(true)

    const load = async (): Promise<void> => {
      const queryId = `table_${tab.id}`
      const salto = pagina * tamanhoPagina
      // Sem ORDER BY, o LIMIT/OFFSET não tem ordem garantida: o banco pode
      // devolver as linhas em ordem diferente a cada consulta, e a página 2
      // repetir linhas da 1 ou pular outras — sem nada na tela denunciando.
      // Ancorar na chave primária torna a paginação estável e sai de graça,
      // porque a chave é indexada.
      const ordemEfetiva =
        ordem ?? (chaveDeOrdem ? { column: chaveDeOrdem, direction: 'asc' as const } : null)
      // Pedimos uma linha a mais do que cabe na página. Se ela vier, existe
      // página seguinte — e descobrimos isso sem um COUNT(*), que numa tabela
      // de milhões de linhas trava a abertura por vários segundos.
      const limite = tamanhoPagina + 1
      const sql =
        dialect === 'mongodb'
          ? montarFind(table, ordemEfetiva, limite, salto)
          : montarSelect(table, dialect, ordemEfetiva, limite, salto)

      try {
        const [outcome, cols, idx, rels] = await Promise.all([
          window.vela.query.run({ connectionId, sql, database: database ?? undefined, queryId }),
          window.vela.schema.columns(connectionId, table, database ?? undefined).catch(() => []),
          window.vela.schema.indexes(connectionId, table, database ?? undefined).catch(() => []),
          window.vela.schema.relations(connectionId, table, database ?? undefined).catch(() => [])
        ])

        if (cancelled) return
        setColumns(cols)
        setChaveDeOrdem(cols.find((coluna) => coluna.isPrimaryKey)?.name ?? null)
        setIndexes(idx)
        setRelations(rels)

        // A linha-sonda não pode chegar à grade: ela pertence à próxima página.
        // Exibi-la faria a última linha de cada página aparecer duas vezes.
        const resultados = outcome.results.map((resultado) => {
          const sobrou = resultado.rows.length > tamanhoPagina
          if (!cancelled) setTemProxima(sobrou)
          return sobrou
            ? { ...resultado, rows: resultado.rows.slice(0, tamanhoPagina), rowCount: tamanhoPagina }
            : resultado
        })

        updateTab(tab.id, { results: resultados, error: outcome.error, activeResultIndex: 0 })

        // Ordenação que o banco recusou (coluna de tipo não ordenável, por
        // exemplo) volta atrás sozinha. Sem isso a aba trava: o erro esconde a
        // grade, e sem grade não sobra cabeçalho para clicar e desfazer.
        if (outcome.error && ordem) {
          setOrdem(null)
          notify(`Não dá para ordenar por ${ordem.column}. Voltei à ordem original.`, 'danger')
        }
      } catch (error) {
        if (cancelled) return
        updateTab(tab.id, {
          results: [],
          error: { raw: (error as Error).message, friendly: (error as Error).message }
        })
        if (ordem) setOrdem(null)
      } finally {
        // Sem o finally, qualquer rejeição deixava a aba presa em "Carregando…".
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    connectionId,
    database,
    table,
    dialect,
    ordem,
    chaveDeOrdem,
    pagina,
    tamanhoPagina,
    tab.id,
    updateTab,
    notify
  ])

  const result = tab.results[tab.activeResultIndex]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="structure__tabs">
        {(['dados', 'colunas', 'indices', 'relacoes'] as Panel[]).map((item) => (
          <button
            key={item}
            className={`structure__tab ${panel === item ? 'structure__tab--active' : ''}`}
            onClick={() => setPanel(item)}
          >
            {LABELS[item]}
            {item === 'colunas' && columns.length > 0 && ` (${columns.length})`}
            {item === 'indices' && indexes.length > 0 && ` (${indexes.length})`}
            {item === 'relacoes' && relations.length > 0 && ` (${relations.length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div className="results__empty">
          <span className="spinner" />
          Carregando {table}…
        </div>
      )}

      {!loading && panel === 'dados' && (
        <div className="results">
          {tab.error && <ErrorPanel error={tab.error} />}
          {result && (
            <EditableGrid
              result={result}
              table={table}
              schemaColumns={columns}
              readOnly={!!connection?.readOnly}
              onNotify={notify}
              sort={ordem}
              // Trocar a ordem reexecuta a consulta: o ORDER BY vai para o
              // banco, que ordena a tabela inteira antes de cortar a página.
              // E volta para a primeira página — a linha 250 de outra ordenação
              // não é a mesma linha, então continuar na página 3 não faria sentido.
              onSort={(nova) => {
                setOrdem(nova)
                setPagina(0)
              }}
              onEditCell={async ({ column, value, keys }) => {
                if (!connectionId) return
                await window.vela.data.updateCell({
                  connectionId,
                  table,
                  database: database ?? undefined,
                  column,
                  value,
                  keys
                })
              }}
              onDeleteRow={async (keys) => {
                if (!connectionId) return
                await window.vela.data.deleteRow({
                  connectionId,
                  table,
                  database: database ?? undefined,
                  keys
                })
              }}
            />
          )}

          {result && (
            <div className="paginacao">
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setPagina((p) => Math.max(0, p - 1))}
                disabled={pagina === 0}
                title="Página anterior"
              >
                ‹ Anterior
              </button>

              <span className="paginacao__faixa">
                {result.rowCount === 0
                  ? 'Nenhuma linha nesta página'
                  : `${formatarNumero(pagina * tamanhoPagina + 1)}–${formatarNumero(
                      pagina * tamanhoPagina + result.rowCount
                    )}`}
              </span>

              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setPagina((p) => p + 1)}
                disabled={!temProxima}
                title={temProxima ? 'Próxima página' : 'Esta é a última página'}
              >
                Próxima ›
              </button>

              {pagina > 0 && !ordem && !chaveDeOrdem && (
                <span className="paginacao__aviso" title="Sem chave primária e sem ordenação, o banco não garante quais linhas caem em cada página.">
                  ordem não garantida — clique num cabeçalho para fixar
                </span>
              )}

              <span className="paginacao__espaco" />

              <label className="paginacao__tamanho">
                por página
                <select
                  value={tamanhoPagina}
                  onChange={(evento) => {
                    setTamanhoPagina(Number(evento.target.value))
                    // A página 3 de 100 em 100 não é a página 3 de 1000 em 1000.
                    setPagina(0)
                  }}
                >
                  {TAMANHOS_DE_PAGINA.map((tamanho) => (
                    <option key={tamanho} value={tamanho}>
                      {tamanho}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}

      {!loading && panel === 'colunas' && (
        <div className="structure">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Nome</th>
                <th>Tipo</th>
                <th>Nulo</th>
                <th>Padrão</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.name}>
                  <td>
                    {column.isPrimaryKey ? (
                      <IconKey size={13} style={{ color: 'var(--warning)' }} />
                    ) : column.isForeignKey ? (
                      <IconLink size={13} style={{ color: 'var(--info)' }} />
                    ) : null}
                  </td>
                  <td style={{ fontWeight: 500 }}>{column.name}</td>
                  <td className="mono">{column.type}</td>
                  <td className="mono">{column.nullable ? 'sim' : 'não'}</td>
                  <td className="mono">{column.defaultValue ?? '—'}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>
                    {column.comment ??
                      (column.frequency != null ? `em ${column.frequency}% dos documentos` : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && panel === 'indices' && (
        <div className="structure">
          {indexes.length === 0 ? (
            <div className="tree-empty">Esta tabela não tem índices além da chave primária.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Colunas</th>
                  <th>Único</th>
                  <th>Primário</th>
                </tr>
              </thead>
              <tbody>
                {indexes.map((index) => (
                  <tr key={index.name}>
                    <td style={{ fontWeight: 500 }}>{index.name}</td>
                    <td className="mono">{index.columns.join(', ')}</td>
                    <td>{index.unique ? 'sim' : 'não'}</td>
                    <td>{index.primary ? 'sim' : 'não'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && panel === 'relacoes' && (
        <div className="structure">
          {relations.length === 0 ? (
            <div className="tree-empty">
              Nenhuma chave estrangeira declarada.
              {dialect === 'mongodb' && (
                <>
                  <br />
                  O MongoDB não declara relações — elas ficam na aplicação.
                </>
              )}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coluna</th>
                  <th>Referencia</th>
                  <th>Ao excluir</th>
                  <th>Ao atualizar</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((relation) => (
                  <tr key={relation.constraintName + relation.column}>
                    <td className="mono">{relation.column}</td>
                    <td className="mono">
                      {relation.referencedTable}.{relation.referencedColumn}
                    </td>
                    <td>{relation.onDelete ?? '—'}</td>
                    <td>{relation.onUpdate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

const LABELS: Record<Panel, string> = {
  dados: 'Dados',
  colunas: 'Colunas',
  indices: 'Índices',
  relacoes: 'Relações'
}

/**
 * O ORDER BY vai para o banco, nunca para as linhas já carregadas.
 *
 * A aba mostra no máximo 500 linhas. Ordenar esse recorte no navegador
 * responderia "o maior valor entre as 500 primeiras" quando a pergunta era "o
 * maior valor da tabela" — e a tela ficaria idêntica nos dois casos. O LIMIT
 * fica depois do ORDER BY justamente para o corte acontecer sobre a tabela
 * ordenada.
 */
function montarSelect(
  table: string,
  dialect: string,
  ordem: OrdenacaoDaGrade | null,
  limite: number,
  salto: number
): string {
  const ordenacao = ordem
    ? ` ORDER BY ${quote(ordem.column, dialect)} ${ordem.direction === 'asc' ? 'ASC' : 'DESC'}`
    : ''
  // OFFSET sem ORDER BY não garante ordem estável entre páginas: o banco pode
  // devolver as mesmas linhas em ordem diferente e a página 2 repetir itens da
  // 1. Só emitimos o OFFSET quando ele é necessário, e a paginação de verdade
  // pressupõe uma ordenação — por isso o aviso na barra.
  const paginacao = salto > 0 ? ` LIMIT ${limite} OFFSET ${salto}` : ` LIMIT ${limite}`
  return `SELECT * FROM ${quote(table, dialect)}${ordenacao}${paginacao}`
}

function montarFind(
  table: string,
  ordem: OrdenacaoDaGrade | null,
  limite: number,
  salto: number
): string {
  const ordenacao = ordem
    ? `.sort({ ${JSON.stringify(ordem.column)}: ${ordem.direction === 'asc' ? 1 : -1} })`
    : ''
  const pulo = salto > 0 ? `.skip(${salto})` : ''
  return `db.${table}.find({})${ordenacao}${pulo}.limit(${limite})`
}

/** Opções do seletor. A primeira é o padrão. */
const TAMANHOS_DE_PAGINA = [100, 500, 1000]

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR')
}

/** Cada banco cita identificador de um jeito; errar isso quebra nomes com espaço. */
function quote(name: string, dialect: string): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}
