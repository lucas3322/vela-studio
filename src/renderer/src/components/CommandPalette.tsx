import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SavedQuery } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { useConectarSalva } from '../hooks/useConectarSalva'
import { corDaConexao } from '../styles/connection-colors'
import { destinoDaConexao } from '../utils/destino'
import { fuzzyMatch, splitByMatch } from '../editor/busca-difusa.ts'
import {
  IconCode,
  IconDatabase,
  IconEject,
  IconHelp,
  IconHistory,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSparkle,
  IconSun,
  IconTable,
  IconView
} from './Icons'

type Group = 'acoes' | 'tabelas' | 'salvas' | 'conexoes'

const GROUP_LABEL: Record<Group, string> = {
  acoes: 'Ações',
  tabelas: 'Tabelas',
  salvas: 'Queries salvas',
  conexoes: 'Conexões'
}

const GROUP_ORDER: Group[] = ['acoes', 'tabelas', 'salvas', 'conexoes']

/** Quantos itens por grupo com a busca vazia: o bastante para navegar sem rolar. */
const LIMIT_EMPTY = 8
/** Com busca, mais por grupo — mas a lista inteira continua curta. */
const LIMIT_SEARCH = 12
const LIMIT_TOTAL = 50

interface Item {
  id: string
  group: Group
  label: string
  /** Texto à direita do rótulo: destino da conexão, contagem de linhas. */
  detail?: string
  /** Atalho de teclado equivalente, para a pessoa aprender o caminho curto. */
  shortcut?: string
  /** Termos que também acham o item, sem aparecerem destacados. */
  keywords?: string
  icon: React.ReactNode
  /** Cor do ícone — a das conexões, que pinta a IDE ao conectar. */
  iconColor?: string
  run: () => void
}

interface Ranked {
  item: Item
  score: number
  indices: number[]
}

const numberFormat = new Intl.NumberFormat('pt-BR')

/**
 * Paleta de comandos (⌘K), no gesto do Spotlight.
 *
 * Uma caixa de busca para tudo o que já existe espalhado pela IDE: abrir uma
 * tabela entre duzentas sem rolar a árvore, achar uma query salva pelo nome,
 * trocar de conexão, e as ações do menu — cada uma com o atalho ao lado, para
 * que a paleta ensine o caminho curto em vez de substituí-lo.
 *
 * Cada item faz **exatamente** o que o gesto equivalente faz em outro lugar
 * da UI (duplo clique na árvore, clique na lista de salvas, clique na
 * conexão): a paleta é um atalho, não um segundo caminho com regras próprias.
 */
export function CommandPalette(): React.JSX.Element {
  const close = useAppStore((s) => s.closeCommandPalette)
  const openModal = useAppStore((s) => s.openModal)
  const notify = useAppStore((s) => s.notify)
  const setTheme = useAppStore((s) => s.setTheme)
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sidebarVisible = useAppStore((s) => s.sidebarVisible)
  const toggleHelpPanel = useAppStore((s) => s.toggleHelpPanel)
  const helpPanelVisible = useAppStore((s) => s.helpPanelVisible)

  const activeId = useConnectionStore((s) => s.activeId)
  const activeDatabase = useConnectionStore((s) => s.activeDatabase)
  const saved = useConnectionStore((s) => s.saved)
  const connecting = useConnectionStore((s) => s.connecting)
  const disconnect = useConnectionStore((s) => s.disconnect)
  // Mesmo seletor da barra lateral: devolve o objeto guardado no cache, estável.
  const schema = useConnectionStore((s) => s.currentSchema())
  const openTableTab = useTabStore((s) => s.openTableTab)
  const openQueryTab = useTabStore((s) => s.openQueryTab)
  const conectar = useConectarSalva()

  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Quem abriu a paleta de dentro do editor volta para ele ao cancelar.
  const previousFocus = useRef<Element | null>(null)
  useLayoutEffect(() => {
    previousFocus.current = document.activeElement
    inputRef.current?.focus()
  }, [])

  // As salvas vêm do disco: lidas ao abrir, só da conexão ativa — é nela que
  // a query vai abrir, como na lista da barra lateral.
  useEffect(() => {
    if (!activeId) return
    let vivo = true
    void window.vela.saved.list(activeId).then((lista) => {
      if (vivo) setSavedQueries(lista)
    })
    return () => {
      vivo = false
    }
  }, [activeId])

  const connection = useMemo(() => saved.find((c) => c.id === activeId), [saved, activeId])

  const items = useMemo<Item[]>(() => {
    const list: Item[] = []
    const action = (item: Omit<Item, 'group'>): void => {
      list.push({ ...item, group: 'acoes' })
    }

    if (activeId) {
      action({
        id: 'acao:nova-aba',
        label: 'Nova aba de query',
        shortcut: '⌘T',
        keywords: 'sql editor consulta',
        icon: <IconCode size={15} />,
        run: () => openQueryTab({ connectionId: activeId, database: activeDatabase })
      })
    }
    action({
      id: 'acao:nova-conexao',
      label: 'Nova conexão',
      shortcut: '⌘⇧N',
      keywords: 'banco conectar adicionar',
      icon: <IconPlus size={15} />,
      run: () => openModal('connection', undefined, { novaConexao: true })
    })
    action({
      id: 'acao:historico',
      label: 'Histórico de queries',
      shortcut: '⌘⇧H',
      keywords: 'executadas anteriores',
      icon: <IconHistory size={15} />,
      run: () => openModal('history')
    })
    action({
      id: 'acao:guia',
      label: 'Guia rápido de SQL',
      keywords: 'ajuda cheatsheet referência comandos',
      icon: <IconSparkle size={15} />,
      run: () => openModal('cheatsheet')
    })
    action({
      id: 'acao:receitas',
      label: helpPanelVisible ? 'Esconder painel de receitas' : 'Mostrar painel de receitas',
      shortcut: '⌘J',
      keywords: 'ajuda exemplos receitas',
      icon: <IconHelp size={15} />,
      run: toggleHelpPanel
    })
    action({
      id: 'acao:tema',
      label: resolvedTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro',
      keywords: 'aparência escuro claro dark light',
      icon: resolvedTheme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />,
      run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    })
    action({
      id: 'acao:barra-lateral',
      label: sidebarVisible ? 'Esconder barra lateral' : 'Mostrar barra lateral',
      shortcut: '⌘B',
      keywords: 'sidebar painel',
      icon: <IconSidebar size={15} />,
      run: toggleSidebar
    })
    action({
      id: 'acao:preferencias',
      label: 'Preferências',
      shortcut: '⌘,',
      keywords: 'configurações ajustes cor acento',
      icon: <IconSettings size={15} />,
      run: () => openModal('preferences')
    })
    action({
      id: 'acao:atualizar',
      label: 'Verificar atualizações',
      keywords: 'versão update',
      icon: <IconRefresh size={15} />,
      run: () => openModal('update')
    })
    if (activeId) {
      const name = connection?.name ?? 'banco'
      action({
        id: 'acao:desconectar',
        label: `Desconectar de ${name}`,
        keywords: 'sair fechar conexão',
        icon: <IconEject size={15} />,
        // O mesmo gesto do botão da barra lateral, com a mesma mensagem: as
        // abas ficam, e reconectar devolve tudo onde estava.
        run: () => {
          void disconnect().then(() =>
            notify(`Desconectado de ${name}. Suas abas foram preservadas.`, 'info')
          )
        }
      })
    }

    if (activeId && schema) {
      for (const table of schema.tables) {
        const isView = table.type === 'view'
        list.push({
          id: `tabela:${table.name}`,
          group: 'tabelas',
          label: table.name,
          detail: isView
            ? 'view'
            : table.rowCount != null
              ? `${numberFormat.format(table.rowCount)} linhas`
              : undefined,
          icon: isView ? <IconView size={15} /> : <IconTable size={15} />,
          run: () => openTableTab({ connectionId: activeId, database: activeDatabase, table: table.name })
        })
      }
    }

    if (activeId) {
      for (const sq of savedQueries) {
        list.push({
          id: `salva:${sq.id}`,
          group: 'salvas',
          label: sq.name,
          // O SQL também acha a query, como na lista lateral: quem lembra
          // "aquela do join de pedidos" acha pelo conteúdo.
          keywords: sq.sql,
          icon: <IconCode size={15} />,
          run: () =>
            openQueryTab({
              connectionId: activeId,
              database: activeDatabase,
              sql: sq.sql,
              title: sq.name,
              savedQueryId: sq.id
            })
        })
      }
    }

    for (const c of saved) {
      if (c.id === activeId) continue
      list.push({
        id: `conexao:${c.id}`,
        group: 'conexoes',
        label: c.name,
        detail: destinoDaConexao(c, { comBanco: true }),
        keywords: 'conectar trocar',
        icon: <IconDatabase size={15} />,
        iconColor: corDaConexao(c.color, resolvedTheme),
        run: () => {
          if (!connecting) void conectar(c.id)
        }
      })
    }

    return list
  }, [
    activeId,
    activeDatabase,
    connection,
    schema,
    savedQueries,
    saved,
    connecting,
    resolvedTheme,
    sidebarVisible,
    helpPanelVisible,
    openQueryTab,
    openTableTab,
    openModal,
    toggleHelpPanel,
    toggleSidebar,
    setTheme,
    disconnect,
    notify,
    conectar
  ])

  /** Resultado agrupado e achatado — o índice ativo percorre esta lista. */
  const sections = useMemo(() => {
    const searching = query.trim().length > 0
    const byGroup = new Map<Group, Ranked[]>()

    for (const item of items) {
      let ranked: Ranked | null = null
      const m = fuzzyMatch(query, item.label)
      if (m) ranked = { item, score: m.score, indices: m.indices }
      else if (item.keywords) {
        // Casou só pela palavra-chave: entra, mas abaixo de quem casou pelo
        // nome, e sem destaque — não há letra do rótulo para pintar.
        const k = fuzzyMatch(query, item.keywords)
        if (k) ranked = { item, score: k.score / 4, indices: [] }
      }
      if (!ranked) continue
      const bucket = byGroup.get(item.group) ?? []
      bucket.push(ranked)
      byGroup.set(item.group, bucket)
    }

    const limit = searching ? LIMIT_SEARCH : LIMIT_EMPTY
    let groups = GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
      const ranked = byGroup.get(g)!
      if (searching) ranked.sort((a, b) => b.score - a.score)
      return { group: g, rows: ranked.slice(0, limit), best: ranked[0]?.score ?? 0 }
    })
    // Buscando, o grupo do melhor resultado sobe: digitar o nome de uma
    // tabela não pode deixá-la abaixo de nove ações que casaram por acaso.
    if (searching) groups = [...groups].sort((a, b) => b.best - a.best)

    let total = 0
    const out: Array<{ group: Group; rows: Ranked[]; offset: number }> = []
    for (const g of groups) {
      const rows = g.rows.slice(0, Math.max(0, LIMIT_TOTAL - total))
      if (rows.length === 0) break
      out.push({ group: g.group, rows, offset: total })
      total += rows.length
    }
    return { groups: out, total }
  }, [items, query])

  // Toda busca nova recomeça do primeiro resultado, que é o melhor.
  useEffect(() => setActive(0), [query])

  const flat = useMemo(() => sections.groups.flatMap((g) => g.rows), [sections])

  // O item ativo acompanha o teclado: sem isso, ↓ desce para fora da vista.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const dismiss = (): void => {
    close()
    const prev = previousFocus.current
    if (prev instanceof HTMLElement) prev.focus()
  }

  const runAt = (index: number): void => {
    const row = flat[index]
    if (!row) return
    // Fecha antes de rodar: a ação pode abrir um modal ou focar o editor, e
    // a paleta não pode ficar por cima disputando o foco.
    close()
    row.item.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const n = flat.length
    const down = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')
    const up = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')
    if (down || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault()
      if (n) setActive((i) => (i + 1) % n)
    } else if (up || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault()
      if (n) setActive((i) => (i - 1 + n) % n)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runAt(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      // Primeiro Esc limpa a busca; o segundo fecha — como no Spotlight.
      if (query) setQuery('')
      else dismiss()
    }
  }

  const activeRow = flat[active]

  return (
    <div
      className="comandos-fundo"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <div className="comandos" role="dialog" aria-label="Ir para…" onKeyDown={onKeyDown}>
        <div className="comandos__busca">
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={activeId ? 'Buscar tabela, query salva ou ação…' : 'Buscar conexão ou ação…'}
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls="comandos-lista"
            aria-activedescendant={activeRow ? `comando-${activeRow.item.id}` : undefined}
          />
        </div>

        <div className="comandos__lista" id="comandos-lista" role="listbox" ref={listRef}>
          {sections.total === 0 && (
            <div className="comandos__vazio">Nada encontrado para “{query.trim()}”.</div>
          )}

          {sections.groups.map(({ group, rows, offset }) => (
            <div key={group} className="comandos__grupo" role="group" aria-label={GROUP_LABEL[group]}>
              <div className="comandos__grupo-titulo">{GROUP_LABEL[group]}</div>
              {rows.map(({ item, indices }, k) => {
                const index = offset + k
                const isActive = index === active
                return (
                  <div
                    key={item.id}
                    id={`comando-${item.id}`}
                    role="option"
                    aria-selected={isActive}
                    data-index={index}
                    className={`comandos__item ${isActive ? 'comandos__item--ativo' : ''}`}
                    // `mousemove`, não `mouseenter`: a lista rolando sob um
                    // ponteiro parado não pode roubar a seleção do teclado.
                    onMouseMove={() => {
                      if (!isActive) setActive(index)
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runAt(index)}
                  >
                    <span
                      className="comandos__icone"
                      style={item.iconColor ? { color: item.iconColor } : undefined}
                    >
                      {item.icon}
                    </span>
                    <span className="comandos__rotulo">
                      {splitByMatch(item.label, indices).map((part, p) =>
                        part.match ? (
                          <mark key={p} className="comandos__casou">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={p}>{part.text}</span>
                        )
                      )}
                    </span>
                    {item.detail && <span className="comandos__detalhe">{item.detail}</span>}
                    {item.shortcut && <kbd className="comandos__atalho">{item.shortcut}</kbd>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="comandos__rodape" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>↵</kbd> abrir
          </span>
          <span>
            <kbd>esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  )
}
