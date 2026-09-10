import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DRIVERS,
  type ColumnInfo,
  type ExportProgress,
  type FormatoDeImportacao,
  type ImportProgress,
  type MapeamentoDeColuna,
  type OpcoesDeImportacao,
  type TableInfo
} from '@shared/types'
import { EXPORT_PROGRESS_EVENT, IMPORT_PROGRESS_EVENT } from '@shared/ipc'
import { useAppStore } from '../store/app'
import { corDaConexao } from '../styles/connection-colors'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { SavedQueries } from './SavedQueries'
import { SchemaModelList } from './SchemaModelList'
import { SidebarConnections } from './SidebarConnections'
import { DangerDialog } from './DangerDialog'
import { ImportDialog } from './ImportDialog'
import {
  IconChevronDown,
  IconChevronRight,
  IconColumn,
  IconCopy,
  IconDownload,
  IconEject,
  IconKey,
  IconLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStructure,
  IconTable,
  IconTrash,
  IconUpload,
  IconView
} from './Icons'

const numberFormat = new Intl.NumberFormat('pt-BR', { notation: 'compact' })

interface DangerState {
  kind: 'truncate' | 'drop'
  table: string
  statement: string
}

export function Sidebar(): React.JSX.Element {
  /** Árvore de tabelas ou lista de queries salvas — nunca as duas. */
  const [modo, setModo] = useState<'tabelas' | 'modelagem' | 'salvas'>('tabelas')
  const openModal = useAppStore((s) => s.openModal)
  const notify = useAppStore((s) => s.notify)
  const iniciarExportacao = useAppStore((s) => s.iniciarExportacao)
  const atualizarProgressoExportacao = useAppStore((s) => s.atualizarProgressoExportacao)
  const concluirExportacao = useAppStore((s) => s.concluirExportacao)
  const iniciarImportacao = useAppStore((s) => s.iniciarImportacao)
  const atualizarProgressoImportacao = useAppStore((s) => s.atualizarProgressoImportacao)
  const concluirImportacao = useAppStore((s) => s.concluirImportacao)
  const falharTarefa = useAppStore((s) => s.falharTarefa)
  const fecharTarefa = useAppStore((s) => s.fecharTarefa)
  const {
    activeId,
    activeDatabase,
    databases,
    selectDatabase,
    reloadSchema,
    disconnect,
    loadingSchema
  } = useConnectionStore()
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const temaAtual = useAppStore((s) => s.resolvedTheme)
  const corAtiva = corDaConexao(connection?.color, temaAtual)
  const schema = useConnectionStore((s) => s.currentSchema())
  const { openTableTab, openQueryTab, reloadTab } = useTabStore()

  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [width, setWidth] = useState(264)
  const [menu, setMenu] = useState<{ x: number; y: number; table: TableInfo } | null>(null)
  const [danger, setDanger] = useState<DangerState | null>(null)
  const [importDialog, setImportDialog] = useState<TableInfo | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'
  const isMongo = dialect === 'mongodb'
  const isRedis = dialect === 'redis'

  // Trocar de conexão zera o que estava aberto — os nomes não valem mais.
  useEffect(() => {
    setExpanded(new Set())
    setFilter('')
    setMenu(null)
  }, [activeId, activeDatabase])

  const toggle = useCallback((name: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const tables = useMemo(() => {
    if (!schema) return []
    const term = filter.trim().toLowerCase()
    if (!term) return schema.tables

    // O filtro também procura nos nomes de coluna: é como se acha a tabela
    // quando você lembra do campo, não do nome dela.
    return schema.tables.filter((table) => {
      if (table.name.toLowerCase().includes(term)) return true
      return (schema.columns[table.name] ?? []).some((c) => c.name.toLowerCase().includes(term))
    })
  }, [schema, filter])

  /**
   * Tabelas e views em listas separadas.
   *
   * Misturadas, uma view parece tabela: você tenta editar uma célula, tentar
   * `INSERT`, ou conta a view junto no total e conclui que o banco tem mais
   * entidades do que tem. A distinção existe no catálogo (`type`) desde
   * sempre — só não estava chegando aos olhos de quem usa.
   */
  const tabelas = useMemo(() => tables.filter((t) => t.type !== 'view'), [tables])
  const views = useMemo(() => tables.filter((t) => t.type === 'view'), [tables])

  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarRef.current?.offsetWidth ?? width

    const onMove = (moveEvent: MouseEvent): void => {
      setWidth(Math.min(460, Math.max(200, startWidth + moveEvent.clientX - startX)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleDisconnect = async (): Promise<void> => {
    if (!activeId) return
    const name = connection?.name ?? 'banco'
    // As abas são preservadas de propósito: desconectar não pode apagar o SQL
    // que a pessoa escreveu. Como cada aba pertence a uma conexão, reconectar
    // devolve tudo exatamente onde estava.
    await disconnect()
    notify(`Desconectado de ${name}. Suas abas foram preservadas.`, 'info')
  }

  // ── Ações do menu de contexto ──────────────────────────────────────
  const quote = (name: string): string =>
    dialect === 'mysql' ? `\`${name}\`` : `"${name}"`

  /**
   * `SCAN` equivalente ao `SELECT * FROM tabela LIMIT 100` das outras abas.
   *
   * `src/main/drivers/redis.ts` só reconhece a navegação de pseudo-tabela
   * nesta forma exata, `SCAN <pseudo-tabela> [MATCH padrao]` — é assim que
   * ele diferencia "abrir esta tabela" de um `SCAN <cursor>` de verdade
   * digitado no console. Um `SCAN 0 MATCH * TYPE hash` (sintaxe real do
   * Redis) cairia no caminho de comando cru, devolvendo cursor+chaves em vez
   * da grade de três colunas — e a exportação, que usa este mesmo comando,
   * pararia de fazer streaming de verdade. `TYPE` não entra aqui porque o
   * tipo já está implícito no nome da pseudo-tabela.
   */
  const comandoScanPseudoTabela = (pseudoTabela: string): string => `SCAN ${pseudoTabela} MATCH *`

  const openInEditor = (sql: string, title?: string): void => {
    if (!activeId) return
    openQueryTab({ connectionId: activeId, database: activeDatabase, sql, title })
  }

  const generateCreate = async (table: string): Promise<void> => {
    if (!activeId) return
    try {
      const ddl = await window.vela.schema.createStatement(
        activeId,
        table,
        activeDatabase ?? undefined
      )
      if (!ddl.trim()) {
        notify('O banco não devolveu DDL para este objeto.', 'danger')
        return
      }
      openInEditor(ddl, `DDL ${table}`)
    } catch (error) {
      notify((error as Error).message, 'danger')
    }
  }

  const copyCreate = async (table: string): Promise<void> => {
    if (!activeId) return
    try {
      const ddl = await window.vela.schema.createStatement(
        activeId,
        table,
        activeDatabase ?? undefined
      )
      await navigator.clipboard.writeText(ddl)
      notify('SQL de criação copiado.', 'success')
    } catch (error) {
      notify((error as Error).message, 'danger')
    }
  }

  /**
   * Exporta a tabela inteira.
   *
   * Consulta o banco **em fluxo**, pelo processo principal, em vez de rodar a
   * query e reempacotar o que voltou. O caminho antigo cortava em 100.000
   * linhas; o da aba de query cortava na prévia e gravava 100 linhas de uma
   * tabela de 250.000, com um "Salvo em…" verde na tela. Aqui não há teto: as
   * linhas nem passam pelo renderer, e acima de um milhão o arquivo é dividido
   * para continuar abrindo em planilha.
   */
  /**
   * O andamento aparece no card do canto (`ProgressToast`), não no toast
   * central: exportar uma tabela grande pode levar minutos, e um toast que
   * some em 4 segundos não é onde essa espera deveria ser acompanhada.
   *
   * `totalEstimado` vem do `rowCount` que a própria árvore já mostra — é a
   * contagem do catálogo, por isso a % que ele produz é rotulada como
   * estimativa lá no card, nunca como fato.
   */
  const exportar = async (table: TableInfo, formato: 'csv' | 'json'): Promise<void> => {
    if (!activeId) return

    const sql =
      dialect === 'mongodb'
        ? `db.${table.name}.find({})`
        : dialect === 'redis'
          ? comandoScanPseudoTabela(table.name)
          : `SELECT * FROM ${quote(table.name)}`

    iniciarExportacao(`${table.name}.${formato}`, table.rowCount)
    const pararDeEscutarProgresso = window.velaEvents.on(EXPORT_PROGRESS_EVENT, ((
      progresso: ExportProgress
    ) => atualizarProgressoExportacao(progresso)) as never)

    try {
      const saida = await window.vela.app.exportQuery({
        connectionId: activeId,
        sql,
        database: activeDatabase ?? undefined,
        format: formato,
        suggestedName: table.name,
        totalEstimado: table.rowCount
      })

      if (!saida) {
        fecharTarefa() // o usuário cancelou o diálogo de salvar
        return
      }
      concluirExportacao(saida.arquivos, saida.linhas)
    } catch (erro) {
      falharTarefa(erro instanceof Error ? erro.message : 'Falha ao exportar.')
    } finally {
      pararDeEscutarProgresso()
    }
  }

  /**
   * Executa a importação depois que o `ImportDialog` já fechou.
   *
   * Fica no Sidebar, não no diálogo: o card de progresso precisa sobreviver
   * ao fechamento da modal, e a chamada de IPC não pode morrer com o
   * componente que a disparou.
   */
  const executarImportacao = async (
    table: string,
    params: {
      caminho: string
      formato: FormatoDeImportacao
      mapeamento: MapeamentoDeColuna[]
      opcoes: OpcoesDeImportacao
    }
  ): Promise<void> => {
    if (!activeId) return
    const importId = `import_${Date.now()}`

    iniciarImportacao(table)
    const pararDeEscutarProgresso = window.velaEvents.on(IMPORT_PROGRESS_EVENT, ((
      progresso: ImportProgress
    ) => atualizarProgressoImportacao(progresso)) as never)

    try {
      const resultado = await window.vela.app.importRun({
        connectionId: activeId,
        table,
        database: activeDatabase ?? undefined,
        caminho: params.caminho,
        formato: params.formato,
        mapeamento: params.mapeamento,
        opcoes: params.opcoes,
        importId
      })
      concluirImportacao(resultado)

      // A grade só mostra o que entrou se a aba e o schema forem recarregados
      // — sem isto, a importação teria acontecido no banco mas não na tela.
      await reloadSchema()
      const aba = useTabStore
        .getState()
        .tabs.find(
          (t) =>
            t.kind === 'table' &&
            t.table === table &&
            t.connectionId === activeId &&
            t.database === (activeDatabase ?? null)
        )
      if (aba) reloadTab(aba.id)
    } catch (erro) {
      falharTarefa(erro instanceof Error ? erro.message : 'Falha ao importar.')
    } finally {
      pararDeEscutarProgresso()
    }
  }

  const askDanger = async (kind: 'truncate' | 'drop', table: string): Promise<void> => {
    if (!activeId) return
    const statement = await window.vela.schema.dangerStatement(activeId, kind, table)
    setDanger({ kind, table, statement })
  }

  const runDanger = async (): Promise<void> => {
    if (!danger || !activeId) return
    const { statement, kind, table } = danger
    setDanger(null)
    const outcome = await window.vela.query.run({
      connectionId: activeId,
      sql: statement,
      database: activeDatabase ?? undefined,
      queryId: `danger_${Date.now()}`
    })
    if (outcome.error) {
      notify(outcome.error.friendly, 'danger')
      return
    }
    notify(
      kind === 'truncate' ? `Tabela ${table} esvaziada.` : `Tabela ${table} apagada.`,
      'success'
    )
    await reloadSchema()
  }

  const buildMenu = (table: TableInfo): MenuEntry[] => {
    const readOnly = !!connection?.readOnly
    const label = isMongo ? 'coleção' : isRedis ? 'pseudo-tabela' : 'tabela'

    const entries: MenuEntry[] = [
      {
        label: 'Ver dados',
        icon: <IconTable size={14} />,
        onSelect: () =>
          activeId &&
          openTableTab({
            connectionId: activeId,
            database: activeDatabase,
            table: table.name,
            initialPanel: 'dados'
          })
      },
      {
        label: 'Ver estrutura',
        icon: <IconStructure size={14} />,
        onSelect: () =>
          activeId &&
          openTableTab({
            connectionId: activeId,
            database: activeDatabase,
            table: table.name,
            initialPanel: 'colunas'
          })
      },
      'separator'
    ]

    // O Redis não tem DDL: a pseudo-tabela não é um objeto de schema que se
    // possa criar de novo, é uma leitura sintética por TYPE. Oferecer "gerar
    // CREATE" aqui não teria o que gerar.
    if (!isRedis) {
      entries.push(
        {
          label: isMongo ? 'Gerar script de criação' : 'Gerar SQL CREATE',
          icon: <IconStructure size={14} />,
          onSelect: () => void generateCreate(table.name)
        },
        {
          label: isMongo ? 'Copiar script de criação' : 'Copiar SQL CREATE',
          icon: <IconCopy size={14} />,
          onSelect: () => void copyCreate(table.name)
        }
      )
    }

    entries.push(
      {
        label: isMongo ? 'Gerar consulta' : isRedis ? 'Gerar comando' : 'Gerar SELECT',
        icon: <IconStructure size={14} />,
        onSelect: () =>
          openInEditor(
            isMongo
              ? `db.${table.name}.find({}).limit(100)`
              : isRedis
                ? comandoScanPseudoTabela(table.name)
                : `SELECT *\nFROM ${quote(table.name)}\nLIMIT 100;`,
            `Query ${table.name}`
          )
      },
      'separator',
      {
        label: `Copiar nome da ${label}`,
        icon: <IconCopy size={14} />,
        onSelect: () => {
          void navigator.clipboard.writeText(table.name)
          notify('Nome copiado.', 'success')
        }
      },
      {
        // Mongo e Redis ainda não têm importação implementada no main — ver
        // a nota em `ImportDialog`/`executarImportacao`. Desabilitar aqui,
        // com o motivo no hint, é melhor do que deixar clicar e estourar um
        // erro cru vindo do IPC.
        label: 'Importar arquivo…',
        icon: <IconUpload size={14} />,
        disabled: readOnly || isMongo || isRedis,
        hint: readOnly ? 'somente leitura' : isMongo || isRedis ? 'ainda não disponível' : undefined,
        onSelect: () => setImportDialog(table)
      },
      {
        label: 'Exportar para CSV…',
        icon: <IconDownload size={14} />,
        hint: 'abre no Excel',
        onSelect: () => void exportar(table, 'csv')
      },
      {
        label: 'Exportar para JSON…',
        icon: <IconDownload size={14} />,
        onSelect: () => void exportar(table, 'json')
      },
      'separator',
      {
        label: isMongo ? 'Esvaziar coleção…' : isRedis ? 'Excluir todas as chaves…' : 'Esvaziar (TRUNCATE)…',
        icon: <IconTrash size={14} />,
        danger: true,
        disabled: readOnly,
        hint: readOnly ? 'somente leitura' : undefined,
        onSelect: () => void askDanger('truncate', table.name)
      }
    )

    // "Apagar" pressupõe um objeto de schema que deixa de existir. A
    // pseudo-tabela Redis não é isso — ela é o tipo `strings`/`hashes`/…, e
    // continua existindo (vazia) enquanto o tipo for válido. "Esvaziar" já
    // cobre o único destino possível aqui: excluir as chaves que ela lista.
    if (!isRedis) {
      entries.push({
        label: isMongo ? 'Apagar coleção…' : 'Apagar tabela (DROP)…',
        icon: <IconTrash size={14} />,
        danger: true,
        disabled: readOnly,
        hint: readOnly ? 'somente leitura' : undefined,
        onSelect: () => void askDanger('drop', table.name)
      })
    }

    return entries
  }

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width }}>
      {/*
        O seletor de conexão só aparece conectado. Desconectado, a lista de
        conexões logo abaixo já é o seletor — repetir "Escolher conexão" em cima
        dela seria o terceiro lugar dizendo a mesma coisa.
      */}
      {activeId && (
      <div className="sidebar__section">
        <div className="sidebar__connection-row">
          <button
            className="sidebar__connection"
            onClick={() => openModal('connection')}
            title="Trocar de conexão"
          >
            {/*
              O ponto usa a cor da conexão quando ela tem uma. O verde de
              "conectado" continua sendo o padrão: quem não pinta nada não
              perde o sinal de estado que já existia.
            */}
            <span
              className={`sidebar__connection-dot ${activeId ? 'sidebar__connection-dot--on' : ''}`}
              style={corAtiva && activeId ? { background: corAtiva } : undefined}
            />
            <span className="sidebar__connection-text">
              <div className="sidebar__connection-name">
                {connection?.name ?? 'Escolher conexão'}
              </div>
              <div className="sidebar__connection-meta">
                {connection
                  ? `${connection.host ?? connection.filePath ?? 'local'}${connection.port ? `:${connection.port}` : ''}`
                  : 'nenhuma conexão ativa'}
              </div>
            </span>
            <IconChevronDown size={13} style={{ color: 'var(--text-tertiary)' }} />
          </button>

          {activeId && (
            <button
              className="icon-btn"
              onClick={() => void handleDisconnect()}
              data-tour="desconectar"
              title="Desconectar deste banco"
            >
              <IconEject size={15} />
            </button>
          )}
        </div>
      </div>
      )}

      {/*
        Sem conexão ativa, a barra lateral não navega schema nenhum: tabelas,
        modelagem e queries salvas pertencem a uma conexão. No lugar entra a
        lista de conexões, para reconectar dali mesmo.
      */}
      {!activeId && <SidebarConnections />}

      {activeId && databases.length > 1 && (
        <div className="sidebar__section">
          <select
            className="input"
            style={{ height: 28, fontSize: 'var(--text-sm)' }}
            value={activeDatabase ?? ''}
            onChange={(e) => void selectDatabase(e.target.value)}
          >
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeId && (
      <>
      <div className="sidebar__modos">
        <button
          className={`sidebar__modo ${modo === 'tabelas' ? 'sidebar__modo--ativo' : ''}`}
          onClick={() => setModo('tabelas')}
        >
          {isMongo ? 'Coleções' : isRedis ? 'Tipos' : 'Tabelas'}
        </button>
        <button
          className={`sidebar__modo ${modo === 'modelagem' ? 'sidebar__modo--ativo' : ''}`}
          onClick={() => setModo('modelagem')}
          title={
            isMongo
              ? 'O MongoDB não declara ligação entre coleções'
              : isRedis
                ? 'O Redis não tem relação entre chaves'
                : 'Tabelas e as ligações entre elas'
          }
        >
          Modelagem
        </button>
        <button
          className={`sidebar__modo ${modo === 'salvas' ? 'sidebar__modo--ativo' : ''}`}
          onClick={() => setModo('salvas')}
          title="Queries que você salvou (⌘S salva a aba atual)"
        >
          Salvas
        </button>
      </div>

      {modo === 'salvas' && <SavedQueries />}

      {modo === 'modelagem' && <SchemaModelList />}

      {modo === 'tabelas' && (
      <>
      <div className="sidebar__search" data-tour="busca">
        <IconSearch size={13} />
        <input
          className="input"
          placeholder={
            isMongo
              ? 'Filtrar coleções e campos'
              : isRedis
                ? 'Filtrar tipos'
                : 'Filtrar tabelas e colunas'
          }
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="sidebar__header">
        <span>
          {isMongo ? 'Coleções' : isRedis ? 'Tipos' : 'Tabelas'}
          {schema ? ` · ${tabelas.length}` : ''}
        </span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button
            className="icon-btn"
            style={{ width: 20, height: 20 }}
            onClick={() => void reloadSchema()}
            title="Recarregar schema"
            disabled={!activeId}
          >
            <IconRefresh size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ width: 20, height: 20 }}
            onClick={() => openModal('connection', undefined, { novaConexao: true })}
            title="Nova conexão (⌘⇧N)"
          >
            <IconPlus size={13} />
          </button>
        </span>
      </div>

      <div className="sidebar__tree">
        {loadingSchema && !schema && (
          <div className="tree-empty">
            <span className="spinner" style={{ margin: '0 auto var(--space-2)' }} />
            <br />
            Lendo estrutura do banco…
          </div>
        )}

        {activeId && schema && tables.length === 0 && (
          <div className="tree-empty">
            {filter ? `Nada encontrado para "${filter}".` : 'Este banco não tem tabelas.'}
          </div>
        )}

        {tabelas.map((table) => (
          <TableNode
            key={table.name}
            table={table}
            columns={schema?.columns[table.name] ?? []}
            expanded={expanded.has(table.name)}
            filter={filter}
            onToggle={() => toggle(table.name)}
            onOpen={() =>
              activeId &&
              openTableTab({ connectionId: activeId, database: activeDatabase, table: table.name })
            }
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, table })
            }}
          />
        ))}

        {views.length > 0 && (
          <div className="sidebar__header sidebar__header--grupo">
            <span>
              <IconView size={12} />
              Views · {views.length}
            </span>
          </div>
        )}

        {views.map((table) => (
          <TableNode
            key={table.name}
            table={table}
            columns={schema?.columns[table.name] ?? []}
            expanded={expanded.has(table.name)}
            filter={filter}
            onToggle={() => toggle(table.name)}
            onOpen={() =>
              activeId &&
              openTableTab({ connectionId: activeId, database: activeDatabase, table: table.name })
            }
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, table })
            }}
          />
        ))}
      </div>
      </>
      )}
      </>
      )}

      <div className="sidebar__resize" onMouseDown={startResize} />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenu(menu.table)}
          onClose={() => setMenu(null)}
        />
      )}

      {danger && (
        <DangerDialog
          kind={danger.kind}
          table={danger.table}
          statement={danger.statement}
          onConfirm={() => void runDanger()}
          onOpenInEditor={() => {
            openInEditor(danger.statement, `${danger.kind} ${danger.table}`)
            setDanger(null)
          }}
          onCancel={() => setDanger(null)}
        />
      )}

      {importDialog && (
        <ImportDialog
          tabela={importDialog.name}
          colunasDaTabela={schema?.columns[importDialog.name] ?? []}
          motivoBloqueio={connection?.readOnly ? 'Esta conexão está em modo somente leitura.' : undefined}
          onFechar={() => setImportDialog(null)}
          onExecutar={(params) => {
            const tabela = importDialog.name
            setImportDialog(null)
            void executarImportacao(tabela, params)
          }}
        />
      )}
    </aside>
  )
}

interface TableNodeProps {
  table: TableInfo
  columns: ColumnInfo[]
  expanded: boolean
  filter: string
  onToggle: () => void
  onOpen: () => void
  onContextMenu: (event: React.MouseEvent) => void
}

function TableNode({
  table,
  columns,
  expanded,
  filter,
  onToggle,
  onOpen,
  onContextMenu
}: TableNodeProps): React.JSX.Element {
  const term = filter.trim().toLowerCase()
  // Com filtro ativo mostramos só as colunas que casaram — senão o resultado
  // da busca vira um monte de ruído em volta do que o usuário procurava.
  const visibleColumns =
    term && !table.name.toLowerCase().includes(term)
      ? columns.filter((c) => c.name.toLowerCase().includes(term))
      : columns

  const shouldExpand = expanded || (term.length > 0 && visibleColumns.length < columns.length)

  return (
    <>
      <button
        className="tree-node"
        onClick={onToggle}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        title={`${table.name} — duplo clique abre os dados, botão direito mostra as ações`}
      >
        <span className="tree-node__chevron">
          {shouldExpand ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        </span>
        <span className="tree-node__icon">
          {table.type === 'view' ? <IconView size={14} /> : <IconTable size={14} />}
        </span>
        <span className="tree-node__label">{table.name}</span>
        {table.rowCount != null && table.rowCount > 0 && (
          <span className="tree-node__count">{numberFormat.format(table.rowCount)}</span>
        )}
      </button>

      {shouldExpand &&
        visibleColumns.map((column) => (
          <div
            key={column.name}
            className="tree-node tree-node--column"
            title={describeColumn(column)}
          >
            <span className="tree-node__icon tree-node__icon--column">
              {column.isPrimaryKey ? (
                <IconKey size={12} style={{ color: 'var(--warning)' }} />
              ) : column.isForeignKey ? (
                <IconLink size={12} style={{ color: 'var(--info)' }} />
              ) : (
                <IconColumn size={12} />
              )}
            </span>
            <span className="tree-node__label">{column.name}</span>
            <span className="tree-node__type">{column.type}</span>
          </div>
        ))}

      {shouldExpand && visibleColumns.length === 0 && (
        <div className="tree-node tree-node--column" style={{ color: 'var(--text-tertiary)' }}>
          <span className="tree-node__label">sem colunas carregadas</span>
        </div>
      )}
    </>
  )
}

function describeColumn(column: ColumnInfo): string {
  const parts = [`${column.name}: ${column.type}`]
  if (column.isPrimaryKey) parts.push('chave primária')
  if (column.isForeignKey) parts.push('chave estrangeira')
  parts.push(column.nullable ? 'aceita NULL' : 'obrigatória')
  if (column.frequency != null) parts.push(`presente em ${column.frequency}% dos documentos`)
  if (column.comment) parts.push(column.comment)
  return parts.join(' · ')
}
