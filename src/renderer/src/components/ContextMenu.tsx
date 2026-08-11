import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onSelect?: () => void
  /** Item destrutivo: pintado em vermelho, sempre no fim da lista. */
  danger?: boolean
  disabled?: boolean
  /** Atalho exibido à direita, meramente informativo. */
  hint?: string
}

export type MenuEntry = MenuItem | 'separator'

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

/**
 * Menu de contexto posicionado no cursor.
 *
 * Renderiza em `position: fixed` e se reposiciona quando não cabe na janela —
 * abrir um menu perto da borda inferior e ver metade dele cortada é o tipo de
 * detalhe que faz a interface parecer amadora.
 */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y, visible: false })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    const margin = 8
    setPosition({
      left: Math.min(x, window.innerWidth - width - margin),
      top: Math.min(y, window.innerHeight - height - margin),
      visible: true
    })
  }, [x, y, items])

  useEffect(() => {
    /**
     * Fecha só quando o clique cai FORA do menu — verificando o alvo, e não
     * confiando em `stopPropagation`.
     *
     * O React registra `onMouseDown` na raiz da aplicação, não no elemento.
     * Um listener nativo em fase de captura roda antes disso, então o
     * `stopPropagation()` do menu chegava tarde: o menu fechava no `mousedown`,
     * o botão desmontava, e o `click` nunca acontecia. Na prática nenhum item
     * do menu funcionava.
     */
    const aoApontarFora = (event: MouseEvent): void => {
      if (ref.current?.contains(event.target as Node)) return
      onClose()
    }
    const fechar = (): void => onClose()
    const aoTeclar = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('mousedown', aoApontarFora, { capture: true })
    window.addEventListener('resize', fechar)
    window.addEventListener('keydown', aoTeclar)
    return () => {
      window.removeEventListener('mousedown', aoApontarFora, { capture: true })
      window.removeEventListener('resize', fechar)
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.visible ? 'visible' : 'hidden'
      }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={`sep-${index}`} className="context-menu__separator" />
        ) : (
          <button
            key={item.label}
            className={`context-menu__item ${item.danger ? 'context-menu__item--danger' : ''}`}
            disabled={item.disabled}
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect?.()
            }}
          >
            {item.icon && <span className="context-menu__icon">{item.icon}</span>}
            <span className="context-menu__label">{item.label}</span>
            {item.hint && <span className="context-menu__hint">{item.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}
