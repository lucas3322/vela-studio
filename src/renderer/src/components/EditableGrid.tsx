import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, QueryResult } from '@shared/types'
import { useAppStore } from '../store/app'
import { mesmoValor, paraEdicao } from '../editor/cell-value'
import { digitandoEmCampo, focoAtual } from '../editor/foco'
import { CellEditorModal } from './CellEditorModal'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { TruncationNotice } from './TruncationNotice'
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
  /**
   * Motivo, vindo de quem chama, para a edição estar bloqueada.
   *
   * A grade sabe dizer "sem chave primária" e "conexão somente leitura", mas
   * não sabe que a consulta tinha um JOIN — quem monta o resultado é que sabe.
   * Sem isto, um resultado de query aparecia como "só em abas de tabela", que
   * deixou de ser verdade e não explicava nada.
   */
  motivoExterno?: string
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
  /** Identificador da aba, para o store saber de quem são as pendências. */
  abaId?: string
  /**
   * Chamado quando **tudo** foi gravado sem falha.
   *
   * Só nesse caso: com alguma pendência restante, reconsultar o banco
   * descartaria em silêncio a alteração que ainda não entrou.
   */
  onApplied?: () => void
}

export interface OrdenacaoDaGrade {
  column: string
  direction: 'asc' | 'desc'
}

/**
 * O que está selecionado agora.
 *
 * União, não dois estados separados: célula e linha são mutuamente
 * exclusivas, e com dois booleanos daria para acabar com as duas marcadas ao
 * mesmo tempo — aí o ⌘C não saberia o que copiar.
 */
type Selecao =
  | { tipo: 'celula'; linha: number; coluna: number }
  | { tipo: 'linha'; linha: number }
  | null

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
  motivoExterno,
  onEditCell,
  onDeleteRow,
  onNotify,
  sort,
  onSort,
  onPendingChange,
  abaId,
  onApplied
}: Props): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const [widths, setWidths] = useState<number[]>([])
  const [selecao, setSelecao] = useState<Selecao>(null)
  const [editing, setEditing] = useState<{ row: number; col: number; valor: string } | null>(null)
  /**
   * Célula aberta na janela de edição. Separado de `editing` de propósito:
   * são dois caminhos para a mesma alteração pendente, e misturá-los faria
   * a caixa da linha e a janela disputarem o foco.
   */
  const [edicaoAmpla, setEdicaoAmpla] = useState<{ linha: number; coluna: number } | null>(null)
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
    const quantas = Object.keys(pendentes).length + exclusoesPendentes.size
    onPendingChange?.(quantas)
    // Também no store: quem executa uma consulta precisa saber que há
    // alteração pendente aqui, e não tem como enxergar o estado local desta
    // grade.
    if (abaId) useAppStore.getState().registrarPendencias(abaId, quantas)
  }, [pendentes, exclusoesPendentes, onPendingChange, abaId])

  // Ao sair, a aba deixa de ter pendências — senão o total contaria para sempre
  // uma grade que não existe mais.
  useEffect(() => {
    return () => {
      if (abaId) useAppStore.getState().registrarPendencias(abaId, 0)
    }
  }, [abaId])

  /*
    Descarte pedido de fora: a pessoa mandou rodar outra consulta e confirmou
    que podia jogar fora o que estava pendente.
  */
  const pedidoDeDescarte = useAppStore((s) => s.pedidoDeDescarte)
  const primeiroDescarte = useRef(pedidoDeDescarte)
  useEffect(() => {
    if (pedidoDeDescarte === primeiroDescarte.current) return
    primeiroDescarte.current = pedidoDeDescarte
    setPendentes({})
    setExclusoesPendentes(new Set())
  }, [pedidoDeDescarte])

  /**
   * Tipo real de cada coluna, vindo do catálogo.
   *
   * O `QueryResult` só carrega a categoria inferida (`string`, `number`), que
   * serve para colorir a célula mas diz pouco: `varchar(32)` e `text` viram
   * ambos "STRING". Quando a aba é de tabela temos o tipo de verdade, e é ele
   * que ajuda a decidir se um valor cabe.
   */
  const tiposReais = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const coluna of schemaColumns ?? []) mapa[coluna.name] = coluna.type
    return mapa
  }, [schemaColumns])

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
  const motivoSemEdicao = motivoExterno
    ? motivoExterno
    : !table
      ? 'a origem da linha não foi identificada'
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

  /**
   * Assinatura das colunas do resultado anterior.
   *
   * Reordenar ou virar a página traz **as mesmas colunas** com outras linhas.
   * Quando é esse o caso, largura e rolagem horizontal são a referência visual
   * de onde a pessoa estava — recalcular tudo a joga de volta para a primeira
   * coluna e desfaz qualquer redimensionamento que ela tenha feito à mão.
   */
  const assinaturaAnterior = useRef<string>('')

  useEffect(() => {
    // `\u0000` como separador: nome de coluna pode conter vírgula ou espaço,
    // e duas listas diferentes não podem produzir a mesma assinatura.
    const assinatura = result.columns.map((c) => c.name).join('\u0000')
    const mesmasColunas = assinatura === assinaturaAnterior.current
    assinaturaAnterior.current = assinatura

    if (!mesmasColunas) {
      // Larguras derivadas do conteúdo: uma amostra basta e é barata.
      const amostra = result.rows.slice(0, 60)
      setWidths(
        result.columns.map((coluna, indice) => {
          /*
            O cabeçalho desenha nome **e** tipo, lado a lado. Medindo só o nome,
            uma coluna de dados curtos ficava estreita demais e era o **nome**
            que sumia em reticências — a pessoa via `p.  decimal(10,2)` e não
            tinha como saber que coluna era aquela. O tipo sai em fonte menor,
            daí o fator diferente.
          */
          const tipo = tiposReais[coluna.name] ?? coluna.type
          const chave = chavesPrimarias.includes(coluna.name) ? 18 : 0
          const cabecalho = coluna.name.length * 7 + tipo.length * 5.5 + 44 + chave

          const conteudo = amostra.reduce((max, linha) => {
            const texto = formatarCelula(linha[indice])
            return Math.max(max, Math.min(texto.length, 60) * 7 + 20)
          }, 0)

          // O teto vale para o conteúdo, não para o cabeçalho: uma coluna com
          // nome longo precisa caber inteira mesmo que os dados sejam curtos —
          // ou vazios, que é justamente quando o nome é a única pista.
          return Math.max(90, cabecalho, Math.min(420, conteudo))
        })
      )
    }

    setScrollTop(0)
    setSelecao(null)
    setEditing(null)
    setPendentes({})
    setExclusoesPendentes(new Set())
    setExcluidas(new Set())

    // O vertical volta ao topo sempre — a ordem das linhas mudou, e continuar
    // na linha 400 não significa nada. O horizontal só volta quando o conjunto
    // de colunas muda de verdade.
    const elemento = scroller.current
    if (elemento) {
      elemento.scrollTo({ top: 0, left: mesmasColunas ? elemento.scrollLeft : 0 })
    }
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
      setEditing({ row: linha, col: coluna, valor: paraEdicao(atual) })
    },
    [podeEditar, motivoSemEdicao, onNotify, valorDe]
  )

  const abrirEdicaoAmpla = useCallback(
    (linha: number, coluna: number) => {
      if (!podeEditar) {
        if (motivoSemEdicao) onNotify?.(`Edição indisponível: ${motivoSemEdicao}.`, 'info')
        return
      }
      setEditing(null)
      setEdicaoAmpla({ linha, coluna })
    },
    [podeEditar, motivoSemEdicao, onNotify]
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
        // Comparação por texto: numa coluna JSON o original é objeto e o novo
        // é string, então `===` nunca casaria e abrir a célula sem mexer em
        // nada já a marcaria como alterada.
        if (mesmoValor(novo, original)) {
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
        onApplied?.()
      } else {
        onNotify?.(
          `${gravadas} gravada(s), ${falhas.length} falhou(ram). ${falhas[0]}`,
          'danger'
        )
      }
    } finally {
      setAplicando(false)
    }
  }, [
    aplicando,
    pendentes,
    exclusoesPendentes,
    chaveDaLinha,
    onEditCell,
    onDeleteRow,
    onNotify,
    onApplied
  ])

  // ── Teclado ────────────────────────────────────────────────────────

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (editing) return
      if (!selecao) return
      // Este listener é no `window`, então vale na tela inteira. Sem esta
      // guarda, uma célula selecionada fazia o Enter do editor de SQL abrir o
      // editor da célula — e o `preventDefault` abaixo comia a quebra de linha
      // da consulta. O ⌘C copiava a célula no lugar do SQL selecionado.
      if (digitandoEmCampo(focoAtual(document.activeElement))) return

      if (evento.key === 'Escape') {
        setSelecao(null)
        return
      }

      if ((evento.metaKey || evento.ctrlKey) && evento.key === 'c') {
        // Linha vai em TSV: é o formato que a planilha cola em colunas
        // separadas. Copiar a linha como uma frase só seria inútil.
        const texto =
          selecao.tipo === 'linha'
            ? result.columns.map((_, i) => formatarCelula(valorDe(selecao.linha, i))).join('\t')
            : formatarCelula(valorDe(selecao.linha, selecao.coluna))
        void navigator.clipboard.writeText(texto)
        onNotify?.(selecao.tipo === 'linha' ? 'Linha copiada.' : 'Valor copiado.', 'success')
        return
      }

      if (evento.key === 'Enter' && selecao.tipo === 'celula') {
        evento.preventDefault()
        // ⇧↵ abre na janela: é o caminho para JSON e texto longo, onde a caixa
        // da linha tem altura de uma linha só.
        if (evento.shiftKey) abrirEdicaoAmpla(selecao.linha, selecao.coluna)
        else abrirEdicao(selecao.linha, selecao.coluna)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [selecao, editing, valorDe, abrirEdicao, abrirEdicaoAmpla, result.columns, onNotify])

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
        label: 'Editar na janela',
        hint: '⇧↵',
        disabled: !podeEditar,
        onSelect: () => abrirEdicaoAmpla(linha, coluna)
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
                  <span className="grid__th-type">
                    {tiposReais[coluna.name] ?? coluna.type}
                  </span>
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
                const linhaSelecionada = selecao?.tipo === 'linha' && selecao.linha === indiceLinha
                return (
                  <div
                    key={indiceLinha}
                    className={`grid__row ${indiceLinha % 2 ? 'grid__row--odd' : ''} ${
                      excluida ? 'grid__row--excluida' : ''
                    } ${marcadaParaExcluir ? 'grid__row--marcada' : ''} ${
                      linhaSelecionada ? 'grid__row--selecionada' : ''
                    }`}
                    style={{ width: larguraTotal }}
                  >
                    {/*
                      Clicar no número seleciona a linha inteira, como em
                      qualquer planilha. É `onMouseDown` para casar com o
                      gesto das células — no `click` a seleção só apareceria
                      ao soltar o botão.
                    */}
                    <div
                      className="grid__gutter grid__gutter--clicavel"
                      onMouseDown={() => setSelecao({ tipo: 'linha', linha: indiceLinha })}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelecao({ tipo: 'linha', linha: indiceLinha })
                        setMenu({ x: e.clientX, y: e.clientY, row: indiceLinha, col: 0 })
                      }}
                      title="Clique para selecionar a linha · ⌘C copia para a planilha"
                    >
                      {indiceLinha + 1}
                    </div>
                    {result.columns.map((coluna, indiceColuna) => {
                      const valor = valorDe(indiceLinha, indiceColuna)
                      const marca = `${indiceLinha}:${indiceColuna}`
                      const selecionada =
                        selecao?.tipo === 'celula' &&
                        selecao.linha === indiceLinha &&
                        selecao.coluna === indiceColuna
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
                          onMouseDown={() =>
                            setSelecao({ tipo: 'celula', linha: indiceLinha, coluna: indiceColuna })
                          }
                          onDoubleClick={() => abrirEdicao(indiceLinha, indiceColuna)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setSelecao({ tipo: 'celula', linha: indiceLinha, coluna: indiceColuna })
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

      <TruncationNotice linhas={result.rowCount} cortadoEm={result.truncatedAt} />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={itensDoMenu(menu.row, menu.col)}
          onClose={() => setMenu(null)}
        />
      )}

      {edicaoAmpla && (
        <CellEditorModal
          coluna={result.columns[edicaoAmpla.coluna]}
          valor={valorDe(edicaoAmpla.linha, edicaoAmpla.coluna)}
          onConfirm={(bruto) => {
            encaixar(edicaoAmpla.linha, edicaoAmpla.coluna, bruto)
            setEdicaoAmpla(null)
          }}
          onCancel={() => setEdicaoAmpla(null)}
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
