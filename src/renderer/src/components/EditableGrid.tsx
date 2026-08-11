import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, QueryResult } from '@shared/types'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { IconCopy, IconTrash, IconWarning } from './Icons'

const ROW_HEIGHT = 30
const GUTTER_WIDTH = 52
const OVERSCAN = 8

const numberFormat = new Intl.NumberFormat('pt-BR')

interface Props {
  result: QueryResult
  /** Tabela de origem. Sem ela não há o que editar. */
  table?: string
  /** Colunas do schema — é daqui que sai a chave primária. */
  schemaColumns?: ColumnInfo[]
  readOnly?: boolean
  /** Grava a célula. Deve rejeitar quando o banco recusar. */
  onEditCell?: (params: {
    column: string
    value: unknown
    keys: Record<string, unknown>
  }) => Promise<void>
  onDeleteRow?: (keys: Record<string, unknown>) => Promise<void>
  onNotify?: (mensagem: string, tom?: 'info' | 'success' | 'danger') => void
  /** Ordenação vigente. Quem manda é quem monta a query, não a grade. */
  sort?: OrdenacaoDaGrade | null
  /**
   * Pedido de reordenação. Quando existe, o cabeçalho vira clicável.
   *
   * Recebe a ordem nova (ou null para desligar) e é responsabilidade de quem
   * passa **reconsultar o banco**. Ordenar aqui as linhas já carregadas daria
   * a resposta errada: o resultado é um recorte de 500 linhas, então o "maior
   * valor" da tela seria o maior daquele recorte, não o da tabela — e nada na
   * interface denunciaria a diferença.
   */
  onSort?: (ordem: OrdenacaoDaGrade | null) => void
  /**
   * Avisa quantas alterações estão esperando confirmação.
   *
   * Quem controla paginação e ordenação precisa saber: trocar de página
   * remonta o resultado e apagaria as pendências em silêncio — o usuário
   * voltaria achando que gravou.
   */
  onPendingChange?: (quantidade: number) => void
}

export interface OrdenacaoDaGrade {
  column: string
  direction: 'asc' | 'desc'
}

interface ValorPendente {
  linha: number
  coluna: number
  nomeDaColuna: string
  valor: unknown
  /** Guardado para o "Descartar" e para reverter uma aplicação que falhar. */
  anterior: unknown
}

/**
 * Grade de dados com edição em linha.
 *
 * A edição só é oferecida quando conseguimos identificar a linha com
 * segurança — ou seja, quando a tabela tem chave primária e todas as colunas
 * dela estão no resultado. Sem isso o UPDATE não teria um WHERE que isola uma
 * linha, e não existe desfazer depois do commit.
 *
 * A célula editada fica marcada até o banco confirmar; se ele recusar, o valor
 * antigo volta. Nunca mostramos como salvo algo que não foi.
 */
export function EditableGrid({
  result,
  table,
  schemaColumns,
  readOnly,
  onEditCell,
  onDeleteRow,
  onNotify,
  sort,
  onSort,
  onPendingChange
}: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const [widths, setWidths] = useState<number[]>([])
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const [editing, setEditing] = useState<{ row: number; col: number; valor: string } | null>(null)
  const [aplicando, setAplicando] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null)

  /**
   * Alterações que ainda **não** foram para o banco.
   *
   * Antes cada Enter gravava direto, sem volta: um clique errado numa coluna e
   * o dado já era. Agora a edição fica pendente até você confirmar, e a barra
   * inferior mostra quantas são. A chave é `linha:coluna`.
   *
   * O resultado do banco não é remontado a cada edição — reconsultar a tabela
   * inteira seria lento e faria a rolagem saltar —, então o valor pendente é
   * exibido por cima do original.
   */
  const [pendentes, setPendentes] = useState<Record<string, ValorPendente>>({})
  /** Linhas marcadas para exclusão, também só aplicadas na confirmação. */
  const [exclusoesPendentes, setExclusoesPendentes] = useState<Set<number>>(new Set())
  /** Linhas que o banco já removeu — ficam riscadas até a próxima consulta. */
  const [excluidas, setExcluidas] = useState<Set<number>>(new Set())

  useEffect(() => {
    onPendingChange?.(Object.keys(pendentes).length + exclusoesPendentes.size)
  }, [pendentes, exclusoesPendentes, onPendingChange])

  const chavesPrimarias = useMemo(
    () => (schemaColumns ?? []).filter((c) => c.isPrimaryKey).map((c) => c.name),
    [schemaColumns]
  )

  /** Índice de cada coluna-chave dentro do resultado. */
  const indicesDaChave = useMemo(() => {
    const mapa: Record<string, number> = {}
    for (const nome of chavesPrimarias) {
      const indice = result.columns.findIndex((c) => c.name === nome)
      if (indice === -1) return null // a chave não veio no SELECT
      mapa[nome] = indice
    }
    return chavesPrimarias.length > 0 ? mapa : null
  }, [chavesPrimarias, result.columns])

  const podeEditar = !!table && !readOnly && !!indicesDaChave && !!onEditCell

  /** Por que a edição está indisponível — texto mostrado no menu. */
  const motivoSemEdicao = !table
    ? 'só em abas de tabela'
    : readOnly
      ? 'conexão somente leitura'
      : chavesPrimarias.length === 0
        ? 'tabela sem chave primária'
        : !indicesDaChave
          ? 'a chave primária não está no resultado'
          : undefined

  const chaveDaLinha = useCallback(
    (linha: number): Record<string, unknown> | null => {
      if (!indicesDaChave) return null
      const chaves: Record<string, unknown> = {}
      for (const [nome, indice] of Object.entries(indicesDaChave)) {
        chaves[nome] = result.rows[linha]?.[indice]
      }
      return chaves
    },
    [indicesDaChave, result.rows]
  )

  const valorDe = useCallback(
    (linha: number, coluna: number): unknown => {
      const marca = `${linha}:${coluna}`
      return marca in pendentes ? pendentes[marca].valor : result.rows[linha]?.[coluna]
    },
    [pendentes, result.rows]
  )

  // Larguras derivadas do conteúdo: uma amostra basta e é barata.
  useEffect(() => {
    const amostra = result.rows.slice(0, 60)
    setWidths(
      result.columns.map((coluna, indice) => {
        const cabecalho = coluna.name.length * 7 + 40
        const conteudo = amostra.reduce((max, linha) => {
          const texto = formatarCelula(linha[indice])
          return Math.max(max, Math.min(texto.length, 60) * 7 + 20)
        }, 0)
        return Math.min(420, Math.max(90, cabecalho, conteudo))
      })
    )
    setScrollTop(0)
    setSelected(null)
    setEditing(null)
    setPendentes({})
    setExclusoesPendentes(new Set())
    setExcluidas(new Set())
    scroller.current?.scrollTo({ top: 0, left: 0 })
  }, [result])

  useEffect(() => {
    const elemento = scroller.current
    if (!elemento) return
    const observer = new ResizeObserver(() => setViewportHeight(elemento.clientHeight))
    observer.observe(elemento)
    setViewportHeight(elemento.clientHeight)
    return () => observer.disconnect()
  }, [])

  const { start, end } = useMemo(() => {
    const primeira = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visiveis = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
    return { start: primeira, end: Math.min(result.rows.length, primeira + visiveis) }
  }, [scrollTop, viewportHeight, result.rows.length])

  const larguraTotal = useMemo(
    () => widths.reduce((soma, w) => soma + w, GUTTER_WIDTH),
    [widths]
  )

  // ── Edição ─────────────────────────────────────────────────────────

  const abrirEdicao = useCallback(
    (linha: number, coluna: number) => {
      if (!podeEditar) {
        if (motivoSemEdicao) onNotify?.(`Edição indisponível: ${motivoSemEdicao}.`, 'info')
        return
      }
      const atual = valorDe(linha, coluna)
      setEditing({ row: linha, col: coluna, valor: atual === null ? '' : String(atual) })
    },
    [podeEditar, motivoSemEdicao, onNotify, valorDe]
  )

  /**
   * Registra a alteração como pendente. Nada vai para o banco aqui.
   *
   * O valor original fica guardado: é o que o "Descartar" devolve e o que
   * restauramos quando o banco recusa a gravação na hora de aplicar.
   */
  const encaixar = useCallback(
    (linha: number, coluna: number, bruto: string | null) => {
      const marca = `${linha}:${coluna}`
      const nomeDaColuna = result.columns[coluna].name
      const novo = bruto === null ? null : converter(bruto, result.columns[coluna].type)

      setEditing(null)

      setPendentes((atuais) => {
        // O "anterior" é sempre o valor que veio do banco, não o pendente
        // anterior: editar a mesma célula duas vezes e descartar precisa voltar
        // ao original, não ao passo intermediário.
        const original = atuais[marca]?.anterior ?? result.rows[linha]?.[coluna]
        if (novo === original) {
          // Voltou ao valor de origem: deixa de ser alteração.
          const copia = { ...atuais }
          delete copia[marca]
          return copia
        }
        return {
          ...atuais,
          [marca]: { linha, coluna, nomeDaColuna, valor: novo, anterior: original }
        }
      })
    },
    [result.columns, result.rows]
  )

  const marcarParaExcluir = useCallback((linha: number) => {
    setExclusoesPendentes((atuais) => {
      const copia = new Set(atuais)
      if (copia.has(linha)) copia.delete(linha)
      else copia.add(linha)
      return copia
    })
  }, [])

  const descartar = useCallback(() => {
    setPendentes({})
    setExclusoesPendentes(new Set())
    onNotify?.('Alterações descartadas.', 'info')
  }, [onNotify])

  /**
   * Grava tudo que está pendente.
   *
   * Cada célula é um UPDATE próprio, então uma falha no meio não desfaz as
   * anteriores. Por isso relatamos o número exato de sucessos e mantemos as
   * que falharam ainda pendentes — dizer "aplicado" quando metade não foi
   * seria a pior das saídas.
   *
   * As exclusões vão por último: apagar a linha antes de gravar a célula dela
   * faria o UPDATE não encontrar nada.
   */
  const aplicar = useCallback(async () => {
    if (aplicando) return
    setAplicando(true)

    const falhas: string[] = []
    let gravadas = 0

    try {
      for (const item of Object.values(pendentes)) {
        const chaves = chaveDaLinha(item.linha)
        if (!chaves || !onEditCell) continue
        try {
          await onEditCell({ column: item.nomeDaColuna, value: item.valor, keys: chaves })
          gravadas++
          setPendentes((atuais) => {
            const copia = { ...atuais }
            delete copia[`${item.linha}:${item.coluna}`]
            return copia
          })
        } catch (error) {
          falhas.push(`${item.nomeDaColuna}: ${(error as Error).message}`)
        }
      }

      for (const linha of exclusoesPendentes) {
        const chaves = chaveDaLinha(linha)
        if (!chaves || !onDeleteRow) continue
        try {
          await onDeleteRow(chaves)
          gravadas++
          setExcluidas((atuais) => new Set(atuais).add(linha))
          setExclusoesPendentes((atuais) => {
            const copia = new Set(atuais)
            copia.delete(linha)
            return copia
          })
        } catch (error) {
          falhas.push(`linha ${linha + 1}: ${(error as Error).message}`)
        }
      }

      if (falhas.length === 0) {
        onNotify?.(`${gravadas} alteração(ões) gravada(s).`, 'success')
      } else {
        onNotify?.(
          `${gravadas} gravada(s), ${falhas.length} falhou(ram). ${falhas[0]}`,
          'danger'
        )
      }
    } finally {
      setAplicando(false)
    }
  }, [aplicando, pendentes, exclusoesPendentes, chaveDaLinha, onEditCell, onDeleteRow, onNotify])

  // ── Teclado ────────────────────────────────────────────────────────

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (editing) return
      if (!selected) return

      if ((evento.metaKey || evento.ctrlKey) && evento.key === 'c') {
        void navigator.clipboard.writeText(formatarCelula(valorDe(selected.row, selected.col)))
        return
      }
      if (evento.key === 'Enter') {
        evento.preventDefault()
        abrirEdicao(selected.row, selected.col)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [selected, editing, valorDe, abrirEdicao])

  const iniciarRedimensionamento = (indice: number) => (evento: React.MouseEvent) => {
    evento.preventDefault()
    evento.stopPropagation()
    const inicioX = evento.clientX
    const larguraInicial = widths[indice]

    const aoMover = (mover: MouseEvent): void => {
      setWidths((atuais) => {
        const proximas = [...atuais]
        proximas[indice] = Math.max(60, larguraInicial + mover.clientX - inicioX)
        return proximas
      })
    }
    const aoSoltar = (): void => {
      document.removeEventListener('mousemove', aoMover)
      document.removeEventListener('mouseup', aoSoltar)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', aoMover)
    document.addEventListener('mouseup', aoSoltar)
  }

  const itensDoMenu = (linha: number, coluna: number): MenuEntry[] => {
    const valor = valorDe(linha, coluna)
    const nomeColuna = result.columns[coluna].name
    const copiar = (texto: string, rotulo: string) => () => {
      void navigator.clipboard.writeText(texto)
      onNotify?.(`${rotulo} copiado.`, 'success')
    }
    const linhaComoObjeto = Object.fromEntries(
      result.columns.map((c, i) => [c.name, valorDe(linha, i)])
    )

    return [
      {
        label: 'Editar valor',
        hint: '↵',
        disabled: !podeEditar,
        onSelect: () => abrirEdicao(linha, coluna)
      },
      {
        label: 'Definir como NULL',
        disabled: !podeEditar,
        onSelect: () => encaixar(linha, coluna, null)
      },
      'separator',
      { label: 'Copiar valor', hint: '⌘C', icon: <IconCopy size={14} />, onSelect: copiar(formatarCelula(valor), 'Valor') },
      { label: 'Copiar nome da coluna', icon: <IconCopy size={14} />, onSelect: copiar(nomeColuna, 'Nome') },
      {
        label: 'Copiar linha como JSON',
        icon: <IconCopy size={14} />,
        onSelect: copiar(JSON.stringify(linhaComoObjeto, null, 2), 'Linha')
      },
      {
        label: 'Copiar linha para Excel',
        icon: <IconCopy size={14} />,
        // TSV é o formato que o Excel cola em colunas separadas.
        onSelect: copiar(
          result.columns.map((c, i) => formatarCelula(valorDe(linha, i))).join('\t'),
          'Linha'
        )
      },
      'separator',
      {
        label: exclusoesPendentes.has(linha) ? 'Não excluir esta linha' : 'Marcar linha para exclusão',
        icon: <IconTrash size={14} />,
        danger: true,
        disabled: !podeEditar || !onDeleteRow,
        hint: motivoSemEdicao,
        onSelect: () => marcarParaExcluir(linha)
      }
    ]
  }

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

  const totalPendente = Object.keys(pendentes).length + exclusoesPendentes.size
  const linhas = result.rows.slice(start, end)

  return (
    <>
      <div className="grid" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div className="grid__inner" style={{ width: larguraTotal }}>
          <div className="grid__header" style={{ width: larguraTotal }}>
            <div className="grid__gutter" style={{ background: 'var(--bg-sidebar)' }} />
            {result.columns.map((coluna, indice) => {
              const ehChave = chavesPrimarias.includes(coluna.name)
              const ordenadaPor = sort?.column === coluna.name ? sort.direction : null
              return (
                <div
                  key={coluna.name + indice}
                  className={`grid__th ${onSort ? 'grid__th--ordenavel' : ''} ${
                    ordenadaPor ? 'grid__th--ordenada' : ''
                  }`}
                  style={{ width: widths[indice] }}
                  onClick={() => onSort?.(proximaOrdem(coluna.name, sort ?? null))}
                  title={
                    onSort
                      ? `${coluna.name} (${coluna.type})${ehChave ? ' · chave primária' : ''}\nClique para ordenar pelo banco`
                      : `${coluna.name} (${coluna.type})${ehChave ? ' · chave primária' : ''}`
                  }
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ehChave && <span style={{ color: 'var(--warning)' }}>🔑 </span>}
                    {coluna.name}
                  </span>
                  {ordenadaPor && (
                    <span className="grid__th-ordem">{ordenadaPor === 'asc' ? '↑' : '↓'}</span>
                  )}
                  <span className="grid__th-type">{coluna.type}</span>
                  <span
                    className="grid__th-resize"
                    onMouseDown={iniciarRedimensionamento(indice)}
                    // Sem isto, soltar o mouse depois de redimensionar contaria
                    // como clique no cabeçalho e reordenaria a tabela inteira.
                    onClick={(evento) => evento.stopPropagation()}
                  />
                </div>
              )
            })}
          </div>

          <div style={{ height: result.rows.length * ROW_HEIGHT, position: 'relative' }}>
            <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {linhas.map((_, deslocamento) => {
                const indiceLinha = start + deslocamento
                const excluida = excluidas.has(indiceLinha)
                const marcadaParaExcluir = exclusoesPendentes.has(indiceLinha)
                return (
                  <div
                    key={indiceLinha}
                    className={`grid__row ${indiceLinha % 2 ? 'grid__row--odd' : ''} ${
                      excluida ? 'grid__row--excluida' : ''
                    } ${marcadaParaExcluir ? 'grid__row--marcada' : ''}`}
                    style={{ width: larguraTotal }}
                  >
                    <div className="grid__gutter">{indiceLinha + 1}</div>
                    {result.columns.map((coluna, indiceColuna) => {
                      const valor = valorDe(indiceLinha, indiceColuna)
                      const marca = `${indiceLinha}:${indiceColuna}`
                      const selecionada =
                        selected?.row === indiceLinha && selected?.col === indiceColuna
                      const emEdicao =
                        editing?.row === indiceLinha && editing?.col === indiceColuna

                      if (emEdicao) {
                        return (
                          <div
                            key={indiceColuna}
                            className="grid__cell grid__cell--editando"
                            style={{ width: widths[indiceColuna] }}
                          >
                            <input
                              className="grid__input"
                              autoFocus
                              defaultValue={editing.valor}
                              onBlur={(e) => encaixar(indiceLinha, indiceColuna, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  encaixar(indiceLinha, indiceColuna, e.currentTarget.value)
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault()
                                  setEditing(null)
                                }
                              }}
                            />
                          </div>
                        )
                      }

                      return (
                        <div
                          key={indiceColuna}
                          className={`grid__cell grid__cell--${valor === null ? 'null' : coluna.type} ${
                            selecionada ? 'grid__cell--selected' : ''
                          } ${aplicando && marca in pendentes ? 'grid__cell--salvando' : ''} ${
                            marca in pendentes ? 'grid__cell--alterada' : ''
                          }`}
                          style={{ width: widths[indiceColuna] }}
                          title={valor === null ? 'NULL' : formatarCelula(valor)}
                          onMouseDown={() => setSelected({ row: indiceLinha, col: indiceColuna })}
                          onDoubleClick={() => abrirEdicao(indiceLinha, indiceColuna)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setSelected({ row: indiceLinha, col: indiceColuna })
                            setMenu({
                              x: e.clientX,
                              y: e.clientY,
                              row: indiceLinha,
                              col: indiceColuna
                            })
                          }}
                        >
                          {valor === null ? 'NULL' : formatarCelula(valor)}
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

      {(totalPendente > 0 || aplicando) && (
        <div className="pendencias">
          <span className="pendencias__ponto" />
          <span>
            {Object.keys(pendentes).length > 0 && (
              <>
                <strong>{Object.keys(pendentes).length}</strong> célula(s) alterada(s)
              </>
            )}
            {Object.keys(pendentes).length > 0 && exclusoesPendentes.size > 0 && ' · '}
            {exclusoesPendentes.size > 0 && (
              <>
                <strong>{exclusoesPendentes.size}</strong> linha(s) para excluir
              </>
            )}
          </span>

          <span className="pendencias__nota">nada foi gravado ainda</span>

          <span className="pendencias__espaco" />

          <button
            className="btn btn--secondary btn--sm"
            onClick={descartar}
            disabled={aplicando}
          >
            Descartar
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => void aplicar()} disabled={aplicando}>
            {aplicando ? 'Gravando…' : 'Confirmar alterações'}
          </button>
        </div>
      )}

      {result.truncatedAt && (
        <div className="grid__truncated">
          <IconWarning size={14} />
          Mostrando as primeiras {numberFormat.format(result.truncatedAt)} linhas. Adicione um{' '}
          <code>LIMIT</code> ou filtros para reduzir o resultado.
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itensDoMenu(menu.row, menu.col)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

/**
 * Ciclo do clique no cabeçalho: crescente → decrescente → sem ordenação.
 *
 * O terceiro clique volta à ordem natural do banco em vez de ficar alternando
 * entre asc e desc — sem ele não há como desfazer a ordenação.
 */
export function proximaOrdem(
  coluna: string,
  atual: OrdenacaoDaGrade | null
): OrdenacaoDaGrade | null {
  if (!atual || atual.column !== coluna) return { column: coluna, direction: 'asc' }
  if (atual.direction === 'asc') return { column: coluna, direction: 'desc' }
  return null
}

/**
 * Converte o texto digitado para o tipo da coluna.
 *
 * O input devolve string sempre; mandar "42" para uma coluna inteira faria o
 * banco converter implicitamente (ou reclamar, dependendo do modo). Texto
 * vazio em coluna não textual vira NULL, que é o que se espera ao limpar.
 */
function converter(texto: string, tipo: string): unknown {
  if (tipo === 'number') {
    if (texto.trim() === '') return null
    const numero = Number(texto.replace(',', '.'))
    return Number.isNaN(numero) ? texto : numero
  }
  if (tipo === 'boolean') {
    const normalizado = texto.trim().toLowerCase()
    if (['true', '1', 'sim', 't'].includes(normalizado)) return true
    if (['false', '0', 'não', 'nao', 'f'].includes(normalizado)) return false
    if (normalizado === '') return null
    return texto
  }
  return texto
}

function formatarCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return 'NULL'
  if (typeof valor === 'object') return JSON.stringify(valor)
  if (typeof valor === 'boolean') return valor ? 'true' : 'false'
  const texto = String(valor)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(texto)) {
    return texto.slice(0, 19).replace('T', ' ')
  }
  return texto
}
