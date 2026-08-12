import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueryResult } from '@shared/types'
import { IconWarning } from './Icons'
import { TruncationNotice } from './TruncationNotice'

const ROW_HEIGHT = 30
const GUTTER_WIDTH = 52
/** Linhas renderizadas além da janela visível, para o scroll não piscar. */
const OVERSCAN = 8

const numberFormat = new Intl.NumberFormat('pt-BR')

/**
 * Grid virtualizado.
 *
 * Renderizar 50.000 linhas no DOM trava qualquer navegador; renderizamos
 * apenas a janela visível e posicionamos com `transform`, que não força
 * layout. Larguras de coluna são calculadas uma vez por resultado.
 */
export function ResultsGrid({ result }: { result: QueryResult }): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const [widths, setWidths] = useState<number[]>([])
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)

  // Larguras derivadas do conteúdo: uma amostra basta e é barata.
  useEffect(() => {
    const sample = result.rows.slice(0, 60)
    setWidths(
      result.columns.map((column, index) => {
        const headerWidth = column.name.length * 7 + 40
        const contentWidth = sample.reduce((max, row) => {
          const text = formatCell(row[index])
          return Math.max(max, Math.min(text.length, 60) * 7 + 20)
        }, 0)
        return Math.min(420, Math.max(90, headerWidth, contentWidth))
      })
    )
    setScrollTop(0)
    setSelected(null)
    scroller.current?.scrollTo({ top: 0, left: 0 })
  }, [result])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight))
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  const { start, end } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
    return { start: first, end: Math.min(result.rows.length, first + visible) }
  }, [scrollTop, viewportHeight, result.rows.length])

  const totalWidth = useMemo(
    () => widths.reduce((sum, w) => sum + w, GUTTER_WIDTH),
    [widths]
  )

  const startResize = (index: number) => (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widths[index]

    const onMove = (moveEvent: MouseEvent): void => {
      setWidths((current) => {
        const next = [...current]
        next[index] = Math.max(60, startWidth + moveEvent.clientX - startX)
        return next
      })
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

  // Copiar a célula selecionada com ⌘C, como em qualquer planilha.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (!selected) return
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'c') return
      const value = result.rows[selected.row]?.[selected.col]
      void navigator.clipboard.writeText(formatCell(value))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selected, result.rows])

  if (result.columns.length === 0) {
    return (
      <div className="results__empty">
        <IconWarning size={22} style={{ color: 'var(--success)' }} />
        <div>
          Comando executado com sucesso.
          {result.affectedRows != null && (
            <>
              <br />
              <strong>{numberFormat.format(result.affectedRows)}</strong> linha(s) afetada(s) em{' '}
              {numberFormat.format(result.durationMs)} ms.
            </>
          )}
        </div>
      </div>
    )
  }

  const rows = result.rows.slice(start, end)

  return (
    <>
      <div className="grid" ref={scroller} onScroll={onScroll}>
        <div className="grid__inner" style={{ width: totalWidth }}>
          <div className="grid__header" style={{ width: totalWidth }}>
            <div className="grid__gutter" style={{ background: 'var(--bg-sidebar)' }} />
            {result.columns.map((column, index) => (
              <div key={column.name + index} className="grid__th" style={{ width: widths[index] }}>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={`${column.name} (${column.type})`}
                >
                  {column.name}
                </span>
                <span className="grid__th-type">{column.type}</span>
                <span className="grid__th-resize" onMouseDown={startResize(index)} />
              </div>
            ))}
          </div>

          <div style={{ height: result.rows.length * ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {rows.map((row, offset) => {
                const rowIndex = start + offset
                return (
                  <div
                    key={rowIndex}
                    className={`grid__row ${rowIndex % 2 ? 'grid__row--odd' : ''}`}
                    style={{ width: totalWidth }}
                  >
                    <div className="grid__gutter">{rowIndex + 1}</div>
                    {result.columns.map((column, colIndex) => {
                      const value = row[colIndex]
                      const isSelected = selected?.row === rowIndex && selected?.col === colIndex
                      return (
                        <div
                          key={colIndex}
                          className={`grid__cell grid__cell--${value === null ? 'null' : column.type} ${
                            isSelected ? 'grid__cell--selected' : ''
                          }`}
                          style={{ width: widths[colIndex] }}
                          title={value === null ? 'NULL' : formatCell(value)}
                          onMouseDown={() => setSelected({ row: rowIndex, col: colIndex })}
                        >
                          {value === null ? 'NULL' : formatCell(value)}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <TruncationNotice cortadoEm={result.truncatedAt} />
    </>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value)
  // Data ISO fica mais legível sem o T e sem os milissegundos.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 19).replace('T', ' ')
  }
  return text
}
