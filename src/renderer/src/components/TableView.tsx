import { useEffect, useMemo, useState } from 'react'
import { DRIVERS, type ColumnInfo, type IndexInfo, type RelationInfo } from '@shared/types'
import { tiposDoDialeto } from '../editor/column-types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore, type Tab } from '../store/tabs'
import { montarGrafo } from '../model/schema-graph'
import { EditableGrid, type OrdenacaoDaGrade } from './EditableGrid'
import { AlterColumnDialog } from './AlterColumnDialog'
import { TableFilterBar } from './TableFilterBar'
import { montarFiltroMongo, montarWhere, type Condicao } from '../editor/filter-builder'
import { ErrorPanel } from './ErrorPanel'
import { IconKey, IconLink, IconPlus, IconRefresh } from './Icons'
import { InsertRowDialog } from './InsertRowDialog'

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
  /** Formulário de nova linha aberto. */
  const [inserindo, setInserindo] = useState(false)
  /** Coluna escolhida no filtro, para a grade rolar até ela. */
  const [colunaEmEvidencia, setColunaEmEvidencia] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)
  // Lido uma vez, na criação da aba: mudar a preferência não deve reconsultar
  // as abas que já estão abertas na largada do usuário.
  const [tamanhoPagina, setTamanhoPagina] = useState(
    () => useAppStore.getState().tamanhoPaginaPadrao
  )
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
  /** Alterações na grade esperando confirmação. Trava a navegação enquanto houver. */
  const [pendencias, setPendencias] = useState(0)
  /** Coluna cujo tipo está sendo editado, e o texto digitado. */
  const [tipoEmEdicao, setTipoEmEdicao] = useState<{ coluna: string; texto: string } | null>(null)
  /** ALTER montado pelo driver, aguardando confirmação. */
  const [alterPendente, setAlterPendente] = useState<{ coluna: string; sql: string } | null>(null)
  /** Filtro em vigor. Entra na consulta e volta para a primeira página. */
  const [filtro, setFiltro] = useState<Condicao[]>(
    (tab.initialFilter as Condicao[] | undefined) ?? []
  )

  /*
    Filtro vindo de fora — o clique numa chave estrangeira. Reage ao
    `initialFilter` porque a aba pode ser reaproveitada: clicar em duas chaves
    diferentes para a mesma tabela precisa trocar o filtro, e sem este efeito
    a segunda navegação mostraria o resultado da primeira.
  */
  useEffect(() => {
    if (tab.initialFilter) {
      setFiltro(tab.initialFilter as Condicao[])
      setPagina(0)
    }
  }, [tab.initialFilter])

  const schema = useConnectionStore((s) => s.currentSchema())
  const preferenciaDeInferencia = useAppStore((s) => s.inferirRelacoes)

  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const updateTab = useTabStore((s) => s.updateTab)
  const reloadTab = useTabStore((s) => s.reloadTab)
  const openTableTab = useTabStore((s) => s.openTableTab)
  const notify = useAppStore((s) => s.notify)

  const table = tab.table!

  /**
   * As ligações que a grade pode navegar: declaradas mais, quando fizer
   * sentido, as deduzidas pelo nome da coluna.
   *
   * A dedução existe porque chave estrangeira declarada é minoria em banco
   * real — um CRM inteiro pode nomear tudo com `fk_` e não declarar nenhuma.
   * Sem ela o recurso ficaria invisível justamente para quem mais precisa.
   *
   * Obedece à mesma preferência da modelagem: em `auto`, deduz só quando o
   * banco não declara nada. Um schema bem modelado não ganha palpite em cima.
   */
  const relacoesParaNavegar = useMemo(() => {
    const declaradas = relations.map((r) => ({ ...r, origem: 'declarada' as const }))
    const inferir =
      preferenciaDeInferencia === 'auto'
        ? declaradas.length === 0
        : preferenciaDeInferencia === 'sim'
    if (!inferir || !schema) return declaradas

    const grafo = montarGrafo({
      tables: schema.tables,
      columns: schema.columns,
      relations: [],
      inferir: true
    })
    const provaveis = grafo.arestas
      .filter((a) => a.de === table)
      .map((a) => ({
        constraintName: `provavel_${a.coluna}`,
        column: a.coluna,
        referencedTable: a.para,
        referencedColumn: a.colunaAlvo,
        origem: 'provavel' as const
      }))
    return [...declaradas, ...provaveis]
  }, [relations, schema, preferenciaDeInferencia, table])

  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'

  // SQLite não tem ALTER COLUMN, e Mongo e Redis não têm tipo de coluna. Em
  // vez de oferecer e falhar no clique, o campo já vem desabilitado com o
  // motivo.
  const motivoSemAlterar = connection?.readOnly
    ? 'conexão somente leitura'
    : dialect === 'sqlite'
      ? 'o SQLite não altera tipo de coluna'
      : dialect === 'mongodb'
        ? 'o MongoDB não tem tipo de coluna'
        : dialect === 'redis'
          ? 'o Redis não tem tipo de coluna'
          : undefined
  const podeAlterarTipo = !motivoSemAlterar

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
          ? montarFind(
              table,
              ordemEfetiva,
              limite,
              salto,
              // Os tipos vêm do schema. Sem eles, a igualdade tipada do Mongo
              // procura número onde o documento guarda texto e volta vazia —
              // aqui é o caminho que **executa**, então errar aqui é pior do
              // que errar na prévia.
              montarFiltroMongo(filtro, Object.fromEntries(columns.map((c) => [c.name, c.type])))
            )
          : dialect === 'redis'
            ? // O único filtro é a `key`: FiltroDeChaveRedis sempre manda uma
              // condição única com `coluna: 'key'`, cujo `valor` é o padrão glob.
              montarScanRedis(table, filtro[0]?.valor ?? '', limite, salto)
            : montarSelect(table, dialect, ordemEfetiva, limite, salto, montarWhere(filtro, dialect))

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
    filtro,
    pagina,
    tamanhoPagina,
    tab.id,
    tab.reloadToken,
    updateTab,
    notify
  ])

  /**
   * Pede ao driver o ALTER correspondente — sem executar.
   *
   * Montar o comando no main é o que garante que os atributos existentes
   * sejam preservados (no MySQL, `MODIFY COLUMN` apaga NOT NULL, DEFAULT e
   * COMMENT se não forem reemitidos). A UI nunca escreve DDL.
   */
  const prepararAlteracao = async (coluna: string, novoTipo: string): Promise<void> => {
    setTipoEmEdicao(null)
    if (!connectionId) return

    const atual = columns.find((c) => c.name === coluna)
    if (!atual || novoTipo.trim().toLowerCase() === atual.type.toLowerCase()) return

    try {
      const sql = await window.vela.schema.alterColumnStatement({
        connectionId,
        table,
        column: coluna,
        newType: novoTipo,
        database: database ?? undefined
      })
      setAlterPendente({ coluna, sql })
    } catch (error) {
      notify((error as Error).message, 'danger')
    }
  }

  const executarAlteracao = async (): Promise<void> => {
    if (!alterPendente || !connectionId) return
    const { sql } = alterPendente
    setAlterPendente(null)

    const outcome = await window.vela.query.run({
      connectionId,
      sql,
      database: database ?? undefined,
      queryId: `alter_${tab.id}`
    })

    if (outcome.error) {
      notify(outcome.error.friendly, 'danger')
      return
    }
    notify('Tipo da coluna alterado.', 'success')
    // Relê o catálogo: o tipo efetivo pode diferir do pedido (o banco
    // normaliza "varchar" para "character varying", por exemplo).
    setColumns(await window.vela.schema.columns(connectionId, table, database ?? undefined))
  }

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

      {/*
        A tela de "Carregando" só toma o lugar da grade na primeira carga,
        quando ainda não há nada para mostrar. Numa reordenação ou troca de
        página ela desmontava a grade inteira, e a grade nova vinha com a
        rolagem horizontal zerada — quem estava olhando a vigésima coluna
        voltava para a primeira a cada clique no cabeçalho.
      */}
      {loading && !result && (
        <div className="results__empty">
          <span className="spinner" />
          Carregando {table}…
        </div>
      )}

      {panel === 'dados' && result && (
        <div className={`results ${loading ? 'results--recarregando' : ''}`}>
          <TableFilterBar
              onColunaEscolhida={setColunaEmEvidencia}
            columns={columns}
            dialect={dialect}
            aplicado={filtro}
            disabled={pendencias > 0}
            onAplicar={(condicoes) => {
              // Filtrar muda o conjunto de linhas: continuar na página 5 do
              // resultado anterior mostraria uma página vazia sem explicação.
              setFiltro(condicoes)
              setPagina(0)
            }}
          />
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
              abaId={tab.id}
              colunaEmEvidencia={colunaEmEvidencia}
              relacoes={relacoesParaNavegar}
              onAbrirRelacao={(destino, colunaDestino, valor) => {
                if (!connectionId) return
                openTableTab({
                  connectionId,
                  database,
                  table: destino,
                  initialFilter: [
                    { coluna: colunaDestino, operador: 'igual', valor: String(valor) }
                  ]
                })
              }}
              onPendingChange={setPendencias}
              // Reconsulta depois de gravar. O banco pode ter guardado algo
              // diferente do que foi digitado — trigger, coerção de tipo, um
              // varchar que truncou — e a tela seguiria mostrando o texto do
              // usuário como se fosse o valor real.
              onApplied={() => reloadTab(tab.id)}
              onSort={(nova) => {
                // Reordenar remonta o resultado e levaria as pendências junto.
                if (pendencias > 0) {
                  notify('Confirme ou descarte as alterações antes de reordenar.', 'danger')
                  return
                }
                // O SCAN do Redis não tem ORDER BY equivalente: a ordem das
                // chaves não é estável nem escolhível. Sem esta guarda, a
                // seta de ordenação ficaria acesa no cabeçalho sem que os
                // dados realmente mudassem de ordem — um "ordenado" que mente.
                if (dialect === 'redis') {
                  notify('O Redis não ordena chaves: o SCAN não garante nem aceita ordem.', 'info')
                  return
                }
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
                disabled={pagina === 0 || pendencias > 0}
                title={
                  pendencias > 0
                    ? 'Confirme ou descarte as alterações antes de mudar de página'
                    : 'Página anterior'
                }
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
                disabled={!temProxima || pendencias > 0}
                title={
                  pendencias > 0
                    ? 'Confirme ou descarte as alterações antes de mudar de página'
                    : temProxima
                      ? 'Próxima página'
                      : 'Esta é a última página'
                }
              >
                Próxima ›
              </button>

              {pagina > 0 && !ordem && !chaveDeOrdem && (
                <span className="paginacao__aviso" title="Sem chave primária e sem ordenação, o banco não garante quais linhas caem em cada página.">
                  ordem não garantida — clique num cabeçalho para fixar
                </span>
              )}

              <button
                className="btn btn--secondary btn--sm btn--acento"
                onClick={() => reloadTab(tab.id)}
                disabled={loading || pendencias > 0}
                title={
                  pendencias > 0
                    ? 'Confirme ou descarte as alterações antes de recarregar'
                    : 'Recarregar do banco (⌘R)'
                }
              >
                <IconRefresh size={13} />
                Atualizar
              </button>

              {/*
                Inserir fica ao lado de Atualizar, no rodapé, porque é ali que
                mora o resto do controle da tabela — e porque a linha nova
                aparece no fim da lista, que é para onde o olho vai depois.
              */}
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => setInserindo(true)}
                disabled={loading || pendencias > 0 || !!connection?.readOnly}
                title={
                  connection?.readOnly
                    ? 'Conexão em modo somente-leitura'
                    : pendencias > 0
                      ? 'Confirme ou descarte as alterações antes de inserir'
                      : `Inserir uma linha em ${table}`
                }
              >
                <IconPlus size={13} />
                Inserir
              </button>

              <span className="paginacao__espaco" />

              <label className="paginacao__tamanho">
                por página
                <select
                  value={tamanhoPagina}
                  disabled={pendencias > 0}
                  onChange={(evento) => {
                    setTamanhoPagina(Number(evento.target.value))
                    // A página 3 de 100 em 100 não é a página 3 de 1000 em 1000.
                    setPagina(0)
                  }}
                >
                  {opcoesDeTamanho(tamanhoPagina).map((tamanho) => (
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

      {panel === 'colunas' && (
        <div className="structure">
          <datalist id="vela-tipos-de-coluna">
            {tiposDoDialeto(dialect).map((tipo) => (
              <option key={tipo} value={tipo} />
            ))}
          </datalist>

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
                  <td className="mono">
                    {tipoEmEdicao?.coluna === column.name ? (
                      <input
                        className="grid__input"
                        autoFocus
                        // `list` sugere sem restringir: tipo fora da lista
                        // (enum, decimal com precisão incomum) continua aceito.
                        list="vela-tipos-de-coluna"
                        defaultValue={column.type}
                        onBlur={(e) => void prepararAlteracao(column.name, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void prepararAlteracao(column.name, e.currentTarget.value)
                          }
                          if (e.key === 'Escape') setTipoEmEdicao(null)
                        }}
                      />
                    ) : (
                      <button
                        className="tipo-editavel"
                        disabled={!podeAlterarTipo}
                        title={
                          podeAlterarTipo
                            ? 'Duplo clique para alterar o tipo'
                            : motivoSemAlterar
                        }
                        onDoubleClick={() =>
                          setTipoEmEdicao({ coluna: column.name, texto: column.type })
                        }
                      >
                        {column.type}
                      </button>
                    )}
                  </td>
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

      {inserindo && (
        <InsertRowDialog
          tabela={table}
          colunas={columns}
          semSchema={dialect === 'mongodb' || dialect === 'redis'}
          avisoSemSchema={
            dialect === 'redis'
              ? 'O Redis não declara schema, mas estas 3 colunas são fixas: key, value (texto puro em "strings"; JSON da estrutura nas demais pseudo-tabelas) e ttl (segundos até expirar, ou vazio para nunca expirar).'
              : undefined
          }
          onCancel={() => setInserindo(false)}
          onInserir={async (valores) => {
            if (!connectionId) return
            await window.vela.data.insertRow({
              connectionId,
              table,
              database: database ?? undefined,
              values: valores
            })
            setInserindo(false)
            notify('Linha inserida.', 'success')
            // Recarrega para mostrar o que o banco **realmente** gravou: o
            // auto-incremento, o DEFAULT, o que um trigger tenha mudado. Sem
            // isto a tela mostraria o que foi digitado como se fosse o valor
            // final, e os dois divergem com frequência.
            reloadTab(tab.id)
          }}
        />
      )}

      {alterPendente && (
        <AlterColumnDialog
          table={table}
          column={alterPendente.coluna}
          statement={alterPendente.sql}
          onConfirm={() => void executarAlteracao()}
          onCancel={() => setAlterPendente(null)}
        />
      )}

      {panel === 'indices' && (
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

      {panel === 'relacoes' && (
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
              {dialect === 'redis' && (
                <>
                  <br />
                  O Redis não tem relação entre chaves.
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
  salto: number,
  where = ''
): string {
  const ordenacao = ordem
    ? ` ORDER BY ${quote(ordem.column, dialect)} ${ordem.direction === 'asc' ? 'ASC' : 'DESC'}`
    : ''
  // OFFSET sem ORDER BY não garante ordem estável entre páginas: o banco pode
  // devolver as mesmas linhas em ordem diferente e a página 2 repetir itens da
  // 1. Só emitimos o OFFSET quando ele é necessário, e a paginação de verdade
  // pressupõe uma ordenação — por isso o aviso na barra.
  const paginacao = salto > 0 ? ` LIMIT ${limite} OFFSET ${salto}` : ` LIMIT ${limite}`
  const filtragem = where ? ` ${where}` : ''
  return `SELECT * FROM ${quote(table, dialect)}${filtragem}${ordenacao}${paginacao}`
}

function montarFind(
  table: string,
  ordem: OrdenacaoDaGrade | null,
  limite: number,
  salto: number,
  filtro = '{}'
): string {
  const ordenacao = ordem
    ? `.sort({ ${JSON.stringify(ordem.column)}: ${ordem.direction === 'asc' ? 1 : -1} })`
    : ''
  const pulo = salto > 0 ? `.skip(${salto})` : ''
  return `db.${table}.find(${filtro})${ordenacao}${pulo}.limit(${limite})`
}

/** Tipo Redis correspondente a cada pseudo-tabela sintetizada pelo driver. */
const TIPO_REDIS_POR_PSEUDOTABELA: Record<string, string> = {
  strings: 'string',
  hashes: 'hash',
  lists: 'list',
  sets: 'set',
  'sorted-sets': 'zset'
}

/**
 * Comando Redis equivalente ao `SELECT` paginado dos outros drivers.
 *
 * O Redis não tem `OFFSET` de verdade: `SCAN` devolve um cursor opaco, não
 * uma posição, e a ordem das chaves não é estável entre chamadas. Como a
 * grade desta IDE pagina por página+tamanho fixos — igual aos drivers SQL —,
 * pedimos ao driver os primeiros `salto + limite` resultados a partir do
 * cursor `0`; cabe a ele cortar a página em vista, do mesmo jeito que o
 * `LIMIT/OFFSET` de SQL corta depois do `ORDER BY`. É uma aproximação sabida
 * como imperfeita: sem um cursor real chegando ao renderer, não existe forma
 * de pedir "a próxima leva" sem reler tudo desde o início. `TYPE` restringe
 * ao tipo Redis desta pseudo-tabela; `MATCH` é o único filtro que o Redis
 * aceita aqui, porque não há índice secundário por campo.
 */
function montarScanRedis(table: string, padraoDeChave: string, limite: number, salto: number): string {
  const tipo = TIPO_REDIS_POR_PSEUDOTABELA[table] ?? table
  const padrao = padraoDeChave.trim() || '*'
  return `SCAN 0 MATCH ${padrao} TYPE ${tipo} COUNT ${salto + limite}`
}

/**
 * Opções do seletor.
 *
 * O valor preferido do usuário entra na lista se ainda não estiver lá — senão
 * o `<select>` abriria sem nenhuma opção correspondente ao valor atual e
 * pareceria vazio.
 */
const TAMANHOS_DE_PAGINA = [100, 500, 1000]

function opcoesDeTamanho(preferido: number): number[] {
  return TAMANHOS_DE_PAGINA.includes(preferido)
    ? TAMANHOS_DE_PAGINA
    : [...TAMANHOS_DE_PAGINA, preferido].sort((a, b) => a - b)
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR')
}

/** Cada banco cita identificador de um jeito; errar isso quebra nomes com espaço. */
function quote(name: string, dialect: string): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}
