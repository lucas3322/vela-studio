import { useMemo, useState } from 'react'
import { DRIVERS } from '@shared/types'
import { CATEGORY_LABELS, fillRecipe, recipesFor, type Recipe } from '../editor/snippets'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { insertIntoActiveEditor } from './QueryEditor'
import { IconClose, IconSearch } from './Icons'

/**
 * Receitas prontas, filtradas pelo banco conectado.
 * Clicar insere a query no editor com a tabela selecionada já preenchida —
 * o objetivo é tirar a pessoa do branco, não dar uma aula.
 */
export function HelpPanel(): React.JSX.Element {
  const toggleHelpPanel = useAppStore((s) => s.toggleHelpPanel)
  const openModal = useAppStore((s) => s.openModal)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const schema = useConnectionStore((s) => s.currentSchema())
  const connectionId = useConnectionStore((s) => s.activeId)
  const activeTab = useTabStore((s) =>
    connectionId ? s.tabs.find((t) => t.id === s.activeByConnection[connectionId]) : undefined
  )

  const [filter, setFilter] = useState('')
  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'

  // A tabela da aba aberta, ou a primeira do schema: melhor um chute útil que `{tabela}`.
  const suggestedTable = activeTab?.table ?? schema?.tables[0]?.name
  const suggestedColumn = suggestedTable
    ? schema?.columns[suggestedTable]?.[0]?.name
    : undefined

  const grouped = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const recipes = recipesFor(dialect).filter(
      (recipe) =>
        !term ||
        recipe.title.toLowerCase().includes(term) ||
        recipe.description.toLowerCase().includes(term)
    )
    const map = new Map<Recipe['category'], Recipe[]>()
    for (const recipe of recipes) {
      const list = map.get(recipe.category) ?? []
      list.push(recipe)
      map.set(recipe.category, list)
    }
    return [...map.entries()]
  }, [dialect, filter])

  return (
    <aside className="help-panel">
      <div className="help-panel__header">
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--text-base)' }}>Receitas</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {suggestedTable ? `usando ${suggestedTable}` : 'consultas prontas'}
          </div>
        </div>
        <button className="icon-btn" onClick={toggleHelpPanel}>
          <IconClose />
        </button>
      </div>

      <div className="sidebar__search">
        <IconSearch size={13} />
        <input
          className="input"
          placeholder="Buscar receita"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="help-panel__body">
        {grouped.map(([category, recipes]) => (
          <div key={category}>
            <div className="recipe-category">{CATEGORY_LABELS[category]}</div>
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                className="recipe"
                onClick={() => insertIntoActiveEditor(fillRecipe(recipe, suggestedTable, suggestedColumn))}
                title="Clique para inserir no editor"
              >
                <div className="recipe__title">{recipe.title}</div>
                <div className="recipe__desc">{recipe.description}</div>
              </button>
            ))}
          </div>
        ))}

        {grouped.length === 0 && (
          <div className="tree-empty">Nenhuma receita encontrada para "{filter}".</div>
        )}

        <div style={{ padding: 'var(--space-3)' }}>
          <button
            className="btn btn--secondary"
            style={{ width: '100%' }}
            onClick={() => openModal('cheatsheet')}
          >
            Guia rápido de SQL
          </button>
        </div>
      </div>
    </aside>
  )
}
