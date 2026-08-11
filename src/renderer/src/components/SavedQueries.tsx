import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SavedQuery } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { IconCopy, IconSearch, IconTrash } from './Icons'

/**
 * Lista de queries salvas, no lugar da árvore de tabelas.
 *
 * Mostra as da conexão ativa por padrão. Ver as de outras conexões é possível,
 * mas não é o padrão: uma query escrita para o Postgres raramente roda no
 * Mongo, e uma lista misturada vira um monte de coisa que quebra ao clicar.
 */
export function SavedQueries(): React.JSX.Element {
  const activeId = useConnectionStore((s) => s.activeId)
  const activeDatabase = useConnectionStore((s) => s.activeDatabase)
  const conexoes = useConnectionStore((s) => s.saved)
  const openQueryTab = useTabStore((s) => s.openQueryTab)
  const notify = useAppStore((s) => s.notify)

  const [queries, setQueries] = useState<SavedQuery[]>([])
  const [filtro, setFiltro] = useState('')
  const [soDestaConexao, setSoDestaConexao] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; query: SavedQuery } | null>(null)

  const recarregar = useCallback(async () => {
    const lista = await window.vela.saved.list(
      soDestaConexao && activeId ? activeId : undefined
    )
    setQueries(lista)
  }, [soDestaConexao, activeId])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  // Salvar em outro lugar da UI precisa refletir aqui sem F5.
  useEffect(() => {
    const aoSalvar = (): void => void recarregar()
    window.addEventListener('vela:saved-changed', aoSalvar)
    return () => window.removeEventListener('vela:saved-changed', aoSalvar)
  }, [recarregar])

  const filtradas = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    if (!termo) return queries
    // Busca no nome e no SQL: quem lembra "aquela do join de pedidos" acha
    // pelo conteúdo mesmo tendo batizado de outro jeito.
    return queries.filter(
      (q) => q.name.toLowerCase().includes(termo) || q.sql.toLowerCase().includes(termo)
    )
  }, [queries, filtro])

  const abrir = (query: SavedQuery): void => {
    // Abre sempre na conexão ativa: clicar numa query salva de outro banco e
    // ser jogado para outra conexão sem avisar seria pior que o inconveniente
    // de ela não rodar de primeira.
    if (!activeId) {
      notify('Conecte-se a um banco para abrir a query.', 'danger')
      return
    }
    openQueryTab({
      connectionId: activeId,
      database: activeDatabase,
      sql: query.sql,
      title: query.name,
      savedQueryId: query.id
    })
  }

  const excluir = async (query: SavedQuery): Promise<void> => {
    await window.vela.saved.remove(query.id)
    await recarregar()
    notify(`"${query.name}" foi removida.`, 'success')
  }

  const itensDoMenu = (query: SavedQuery): MenuEntry[] => [
    { label: 'Abrir em nova aba', onSelect: () => abrir(query) },
    {
      label: 'Copiar SQL',
      icon: <IconCopy size={14} />,
      onSelect: () => {
        void navigator.clipboard.writeText(query.sql)
        notify('SQL copiado.', 'success')
      }
    },
    'separator',
    {
      label: 'Excluir',
      icon: <IconTrash size={14} />,
      danger: true,
      onSelect: () => void excluir(query)
    }
  ]

  return (
    <>
      <div className="sidebar__search">
        <IconSearch size={13} />
        <input
          className="input"
          placeholder="Filtrar por nome ou conteúdo"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      </div>

      <div className="sidebar__header">
        <span>Salvas{queries.length > 0 ? ` · ${queries.length}` : ''}</span>
        <button
          className="salvas__escopo"
          onClick={() => setSoDestaConexao((v) => !v)}
          title={
            soDestaConexao
              ? 'Mostrando só as desta conexão. Clique para ver todas.'
              : 'Mostrando de todas as conexões. Clique para filtrar.'
          }
        >
          {soDestaConexao ? 'desta conexão' : 'todas'}
        </button>
      </div>

      <div className="sidebar__tree">
        {filtradas.length === 0 && (
          <div className="tree-empty">
            {queries.length === 0 ? (
              <>
                Nenhuma query salva ainda.
                <br />
                Escreva uma consulta e pressione <kbd>⌘</kbd> <kbd>S</kbd>.
              </>
            ) : (
              'Nada encontrado com esse filtro.'
            )}
          </div>
        )}

        {filtradas.map((query) => (
          <button
            key={query.id}
            className="salvas__item"
            onClick={() => abrir(query)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, query })
            }}
            title={query.sql.slice(0, 400)}
          >
            <span className="salvas__nome">{query.name}</span>
            <span className="salvas__meta">
              {tempoRelativo(query.updatedAt)}
              {!soDestaConexao && (
                <> · {conexoes.find((c) => c.id === query.connectionId)?.name ?? 'conexão removida'}</>
              )}
            </span>
          </button>
        ))}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itensDoMenu(menu.query)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

/** "há 2 meses", como no Beekeeper — data absoluta não ajuda a lembrar qual é qual. */
export function tempoRelativo(quando: number, agora = Date.now()): string {
  const segundos = Math.round((quando - agora) / 1000)
  const formatador = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })

  const escalas: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60]
  ]

  for (const [unidade, tamanho] of escalas) {
    if (Math.abs(segundos) >= tamanho) {
      return formatador.format(Math.round(segundos / tamanho), unidade)
    }
  }
  return 'agora mesmo'
}
