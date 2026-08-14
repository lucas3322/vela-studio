import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DRIVERS, type ColumnInfo, type TableInfo } from '@shared/types'
import { useAppStore } from '../store/app'
import { descreverExportacao } from '../editor/export-message'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { SavedQueries } from './SavedQueries'
import { SchemaModelList } from './SchemaModelList'
import { DangerDialog } from './DangerDialog'
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
  const schema = useConnectionStore((s) => s.currentSchema())
  const { openTableTab, openQueryTab } = useTabStore()

  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [width, setWidth] = useState(264)
  const [menu, setMenu] = useState<{ x: number; y: number; table: TableInfo } | null>(null)
  const [danger, setDanger] = useState<DangerState | null>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'
  const isMongo = dialect === 'mongodb'

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
  const exportar = async (table: string, formato: 'csv' | 'json'): Promise<void> => {
    if (!activeId) return

    const sql = dialect === 'mongodb' ? `db.${table}.find({})` : `SELECT * FROM ${quote(table)}`

    try {
      const saida = await window.vela.app.exportQuery({
        connectionId: activeId,
        sql,
        database: activeDatabase ?? undefined,
        format: formato,
        suggestedName: table
      })

      if (!saida) return // o usuário cancelou o diálogo de salvar
      notify(descreverExportacao(saida), 'success')
    } catch (erro) {
      notify(erro instanceof Error ? erro.message : 'Falha ao exportar.', 'danger')
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
    const label = isMongo ? 'coleção' : 'tabela'

    return [
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
      'separator',
      {
        label: isMongo ? 'Gerar script de criação' : 'Gerar SQL CREATE',
        icon: <IconStructure size={14} />,
        onSelect: () => void generateCreate(table.name)
      },
      {
        label: isMongo ? 'Copiar script de criação' : 'Copiar SQL CREATE',
        icon: <IconCopy size={14} />,
        onSelect: () => void copyCreate(table.name)
      },
      {
        label: isMongo ? 'Gerar consulta' : 'Gerar SELECT',
        icon: <IconStructure size={14} />,
        onSelect: () =>
          openInEditor(
            isMongo
              ? `db.${table.name}.find({}).limit(100)`
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
        label: 'Exportar para CSV…',
        icon: <IconDownload size={14} />,
        hint: 'abre no Excel',
        onSelect: () => void exportar(table.name, 'csv')
      },
      {
        label: 'Exportar para JSON…',
        icon: <IconDownload size={14} />,
        onSelect: () => void exportar(table.name, 'json')
      },
      'separator',
      {
        label: isMongo ? 'Esvaziar coleção…' : 'Esvaziar (TRUNCATE)…',
        icon: <IconTrash size={14} />,
        danger: true,
        disabled: readOnly,
        hint: readOnly ? 'somente leitura' : undefined,
        onSelect: () => void askDanger('truncate', table.name)
      },
      {
        label: isMongo ? 'Apagar coleção…' : 'Apagar tabela (DROP)…',
        icon: <IconTrash size={14} />,
        danger: true,
        disabled: readOnly,
        hint: readOnly ? 'somente leitura' : undefined,
        onSelect: () => void askDanger('drop', table.name)
      }
    ]
  }

  return (
    <aside className="sidebar" ref={sidebarRef} style={{ width }}>
      <div className="sidebar__section">
        <div className="sidebar__connection-row">
          <button
            className="sidebar__connection"
            onClick={() => openModal('connection')}
            title="Trocar de conexão"
          >
            <span
              className={`sidebar__connection-dot ${activeId ? 'sidebar__connection-dot--on' : ''}`}
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
              title="Desconectar deste banco"
            >
              <IconEject size={15} />
            </button>
          )}
        </div>
      </div>

      {databases.length > 1 && (
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

      <div className="sidebar__modos">
        <button
          className={`sidebar__modo ${modo === 'tabelas' ? 'sidebar__modo--ativo' : ''}`}
          onClick={() => setModo('tabelas')}
        >
          {isMongo ? 'Coleções' : 'Tabelas'}
        </button>
        <button
          className={`sidebar__modo ${modo === 'modelagem' ? 'sidebar__modo--ativo' : ''}`}
          onClick={() => setModo('modelagem')}
          title={
            isMongo
              ? 'O MongoDB não declara ligação entre coleções'
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
      <div className="sidebar__search">
        <IconSearch size={13} />
        <input
          className="input"
          placeholder={isMongo ? 'Filtrar coleções e campos' : 'Filtrar tabelas e colunas'}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="sidebar__header">
        <span>
          {isMongo ? 'Coleções' : 'Tabelas'}
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
            onClick={() => openModal('connection')}
            title="Nova conexão (⌘⇧N)"
          >
            <IconPlus size={13} />
          </button>
        </span>
      </div>

      <div className="sidebar__tree">
        {!activeId && (
          <div className="tree-empty">
            Conecte-se a um banco para ver
            <br />
            as tabelas por aqui.
          </div>
        )}

        {activeId && loadingSchema && !schema && (
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
