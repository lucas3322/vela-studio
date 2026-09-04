import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnInfo, Dialect, QueryResult, RelationInfo } from '@shared/types'
import { useAppStore } from '../store/app'
import { mesmoValor, paraEdicao } from '../editor/cell-value'
import { digitandoEmCampo, focoAtual } from '../editor/foco'
import {
  descreverBusca,
  procurarNaGrade,
  proximoAchado,
  type Achado
} from '../editor/busca-na-grade'
import { descreverExportacao } from '../editor/export-message'
import { gerarComandosRedis, gerarInsertMongo, gerarInsertSql } from '../editor/gerar-insert'
import { CellEditorModal } from './CellEditorModal'
import { ContextMenu, type MenuEntry } from './ContextMenu'
import { TruncationNotice } from './TruncationNotice'
import {
  IconClose,
  IconCopy,
  IconDownload,
  IconLink,
  IconSearch,
  IconStructure,
  IconTrash,
  IconWarning
} from './Icons'

const ROW_HEIGHT = 30
const GUTTER_WIDTH = 52
/**
 * Coluna de checkbox, para marcar mais de uma linha e agir sobre o conjunto
 * (exportar, gerar INSERT). Fica à esquerda até do número da linha — é o
 * primeiro gesto de planilha, então ocupa o primeiro lugar.
 */
const CHECK_WIDTH = 32
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
   * Coluna que deve entrar em evidência, vinda de fora.
   *
   * Usada pela barra de filtro: escolher uma coluna lá rola a grade até ela.
   * Numa tabela de 84 colunas, filtrar por um campo que está fora da tela
   * deixava a pessoa sem ver o que ela mesma acabou de escolher.
   */
  colunaEmEvidencia?: string | null
  /**
   * Para onde cada coluna aponta, e com que grau de certeza.
   *
   * `declarada` vem do catálogo do banco e é fato. `provavel` vem da dedução
   * por nome de coluna — a mesma da modelagem — e existe porque chave
   * estrangeira declarada é minoria em banco real: um CRM inteiro pode usar
   * `fk_` no nome e não declarar nenhuma. Sem a dedução, o recurso ficaria
   * invisível justamente em quem mais precisa dele.
   *
   * A diferença **nunca some da tela**: o ícone da provável é vazado e o texto
   * diz que é palpite. Palpite não se veste de fato.
   */
  relacoes?: Array<RelationInfo & { origem?: 'declarada' | 'provavel' }>
  /** Abre a tabela apontada pela chave, já filtrada pelo valor clicado. */
  onAbrirRelacao?: (destino: string, colunaDestino: string, valor: unknown) => void
  /**
   * Chamado quando **tudo** foi gravado sem falha.
   *
   * Só nesse caso: com alguma pendência restante, reconsultar o banco
   * descartaria em silêncio a alteração que ainda não entrou.
   */
  onApplied?: () => void
  /**
   * Dialeto da conexão, só para a barra de seleção múltipla saber que sintaxe
   * usar no "Gerar INSERT" — SQL cita identificador de um jeito por banco, e
   * Mongo e Redis nem falam `INSERT`. Sem isto o botão teria que adivinhar.
   */
  dialect?: Dialect
  /**
   * Abre o texto gerado numa aba de query nova. Mesmo padrão do "Gerar
   * SELECT" da barra lateral (`Sidebar.tsx`, `openInEditor`): só monta o
   * comando, quem decide rodar é o usuário. A grade não conhece aba nem
   * conexão — por isso o prop, em vez de importar o store de abas aqui.
   */
  onGerarComando?: (sql: string, titulo?: string) => void
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
  colunaEmEvidencia,
  relacoes,
  onAbrirRelacao,
  onApplied,
  dialect,
  onGerarComando
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
   * Busca dentro do que já está carregado (⌘F).
   *
   * `aberta` separado do termo: fechar precisa limpar o destaque, mas manter
   * o texto seria pior — reabrir com uma busca velha faz a grade saltar para
   * um lugar que ninguém pediu.
   */
  const [busca, setBusca] = useState<{ aberta: boolean; termo: string; indice: number }>({
    aberta: false,
    termo: '',
    indice: 0
  })

  /**
   * Coluna inteira em realce, quando o achado da busca é um **nome de coluna**.
   *
   * Rolar até a coluna a punha na tela mas não dizia qual das que apareceram
   * era a procurada — numa faixa de oitenta colunas parecidas, "está em algum
   * lugar por aqui" não ajuda. O realce marca a coluna certa, cabeçalho e
   * células, até a busca fechar ou o foco ir para uma célula.
   */
  const [colunaRealcada, setColunaRealcada] = useState<number | null>(null)

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

  /**
   * Linhas marcadas pelo checkbox, para agir sobre o conjunto — exportar ou
   * gerar INSERT. É um conceito **novo e independente** de `selecao`: aquela
   * é o foco de uma célula/linha só (edição, ⌘C), esta é uma multi-marcação
   * para ação em lote. As duas convivem: dá para ter uma célula em foco e três
   * linhas marcadas ao mesmo tempo, então não reaproveitam o mesmo estado nem
   * a mesma classe CSS.
   */
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())
  /** Âncora do shift+clique — o índice do último clique simples no checkbox. */
  const ultimaMarcada = useRef<number | null>(null)

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

  /**
   * Para onde cada coluna aponta, quando aponta.
   *
   * Indexado pelo nome da coluna de origem: é o que a célula precisa consultar
   * a cada render, e varrer a lista de relações por célula numa página de 1000
   * linhas seria trabalho repetido à toa.
   */
  const destinoDaColuna = useMemo(() => {
    const mapa: Record<
      string,
      { tabela: string; coluna: string; provavel: boolean }
    > = {}
    for (const r of relacoes ?? []) {
      // Declarada vence provável quando as duas existem para a mesma coluna:
      // o fato manda no palpite.
      const provavel = r.origem === 'provavel'
      if (mapa[r.column] && !mapa[r.column].provavel && provavel) continue
      mapa[r.column] = { tabela: r.referencedTable, coluna: r.referencedColumn, provavel }
    }
    return mapa
  }, [relacoes])

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

  const achados = useMemo(
    () =>
      busca.aberta
        ? procurarNaGrade({
            termo: busca.termo,
            colunas: result.columns.map((c) => c.name),
            linhas: result.rows,
            formatar: formatarCelula
          })
        : [],
    [busca.aberta, busca.termo, result.columns, result.rows]
  )

  /**
   * Leva o achado para o meio da tela e o seleciona.
   *
   * Rolar só o suficiente para "entrar na tela" deixa o alvo colado na borda,
   * onde o olho não o encontra. Centralizar custa o mesmo e resolve.
   */
  const irPara = useCallback(
    (achado: Achado) => {
      const caixa = scroller.current
      if (!caixa) return

      const esquerda = widths
        .slice(0, achado.coluna)
        .reduce((soma, w) => soma + w, CHECK_WIDTH + GUTTER_WIDTH)
      const left = Math.max(0, esquerda - caixa.clientWidth / 2 + widths[achado.coluna] / 2)

      if (achado.linha != null) {
        const top = Math.max(0, achado.linha * ROW_HEIGHT - caixa.clientHeight / 2)
        caixa.scrollTo({ top, left, behavior: 'smooth' })
        setSelecao({ tipo: 'celula', linha: achado.linha, coluna: achado.coluna })
        // O foco é a célula: um realce de coluna sobrando aqui competiria com
        // ele e diria "é isto" duas vezes, em coisas diferentes.
        setColunaRealcada(null)
      } else {
        // Achado de coluna: rola na horizontal e não mexe na vertical, senão a
        // pessoa perde o lugar onde estava lendo. Sem célula para focar, o que
        // aponta a coluna é o realce dela inteira.
        caixa.scrollTo({ left, behavior: 'smooth' })
        setSelecao(null)
        setColunaRealcada(achado.coluna)
      }
    },
    [widths]
  )

  // Pedido externo de evidência: mesma mecânica da busca, outro gatilho.
  useEffect(() => {
    if (!colunaEmEvidencia || widths.length === 0) return
    const indice = result.columns.findIndex((c) => c.name === colunaEmEvidencia)
    if (indice >= 0) irPara({ tipo: 'coluna', coluna: indice, texto: colunaEmEvidencia })
  }, [colunaEmEvidencia, widths.length, result.columns, irPara])

  // Navegar já ao digitar: a primeira ocorrência aparece sem precisar de Enter.
  useEffect(() => {
    if (!busca.aberta) return
    if (achados.length === 0) {
      // O termo deixou de casar qualquer coluna: um realce velho apontaria
      // uma coluna que a busca atual não escolheu mais.
      setColunaRealcada(null)
      return
    }
    irPara(achados[Math.min(busca.indice, achados.length - 1)])
  }, [busca.aberta, busca.indice, achados, irPara])

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
    // Trocar de página, filtrar, reordenar ou trocar de tabela troca o
    // conjunto de linhas por baixo dos índices marcados: a linha 3 de uma
    // página não é a linha 3 da próxima. Continuar com a marca seria um bug
    // silencioso — pareceria selecionado o que na verdade é outro registro.
    setSelecionadas(new Set())
    ultimaMarcada.current = null

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
    () => widths.reduce((soma, w) => soma + w, CHECK_WIDTH + GUTTER_WIDTH),
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

  // ── Seleção múltipla (pelo número da linha) ───────────────────────────

  /**
   * Seleciona linhas clicando no número, no gesto de qualquer planilha:
   *
   *  - clique simples: seleciona só esta linha, trocando a seleção anterior;
   *  - ⌘/Ctrl+clique: soma ou tira esta linha, sem mexer nas outras;
   *  - Shift+clique: marca o intervalo da âncora (o último clique simples)
   *    até aqui, somando ao que já estava selecionado.
   *
   * Não há mais coluna de checkbox: o número da linha **é** a caixa de
   * seleção. O clique simples também vira o foco da linha (`selecao`), para o
   * ⌘C e o menu de contexto continuarem com um alvo — foco e seleção múltipla
   * convivem: a linha em foco ganha o fundo cheio, as demais selecionadas
   * ficam só com o número em âmbar.
   */
  const selecionarLinha = useCallback(
    (linha: number, mods: { shift: boolean; meta: boolean }) => {
      setSelecionadas((atuais) => {
        // Shift soma o intervalo: marcar a 2, depois shift+clicar na 5, não
        // deveria apagar uma marca distante feita antes.
        if (mods.shift && ultimaMarcada.current !== null) {
          const copia = new Set(atuais)
          const inicio = Math.min(ultimaMarcada.current, linha)
          const fim = Math.max(ultimaMarcada.current, linha)
          for (let i = inicio; i <= fim; i++) copia.add(i)
          return copia
        }
        if (mods.meta) {
          const copia = new Set(atuais)
          if (copia.has(linha)) copia.delete(linha)
          else copia.add(linha)
          ultimaMarcada.current = linha
          return copia
        }
        ultimaMarcada.current = linha
        return new Set([linha])
      })
      setSelecao({ tipo: 'linha', linha })
    },
    []
  )

  const limparSelecao = useCallback(() => {
    setSelecionadas(new Set())
    ultimaMarcada.current = null
  }, [])

  /**
   * Serializa as linhas marcadas e salva em arquivo — CSV ou JSON, mesmo
   * formato da exportação existente (`export-format.ts`, BOM no CSV). A
   * diferença para aquela é só a origem do dado: aqui as linhas já estão na
   * memória da grade, então não há por que consultar o banco de novo — é
   * por isso que chama `app.exportResult` (reempacota o que já tem) e não
   * `app.exportQuery` (que refaz a consulta em fluxo, para exportações que
   * não cabem na grade).
   */
  const exportarSelecionadas = useCallback(
    async (formato: 'csv' | 'json') => {
      const indices = [...selecionadas].sort((a, b) => a - b)
      if (indices.length === 0) return
      const colunas = result.columns.map((c) => c.name)
      const linhas = indices.map((linha) => colunas.map((_, coluna) => valorDe(linha, coluna)))

      try {
        const caminho = await window.vela.app.exportResult({
          format: formato,
          columns: colunas,
          rows: linhas,
          suggestedName: `${table ?? 'selecao'}_selecionadas`
        })
        if (caminho) {
          onNotify?.(descreverExportacao({ arquivos: [caminho], linhas: linhas.length }), 'success')
        }
      } catch (erro) {
        onNotify?.(erro instanceof Error ? erro.message : 'Falha ao exportar.', 'danger')
      }
    },
    [selecionadas, result.columns, valorDe, table, onNotify]
  )

  /**
   * Monta o(s) comando(s) de escrita das linhas marcadas e abre numa aba de
   * query nova — nunca executa. `table` aqui é a origem (tabela, coleção ou
   * pseudo-tabela Redis); sem ela não há para onde gerar o INSERT, porque uma
   * consulta com JOIN não tem um destino único.
   */
  const gerarInsertDasSelecionadas = useCallback(() => {
    if (!table || !onGerarComando) return
    const indices = [...selecionadas].sort((a, b) => a - b)
    if (indices.length === 0) return
    const colunas = result.columns.map((c) => c.name)
    const linhas = indices.map((linha) => colunas.map((_, coluna) => valorDe(linha, coluna)))

    if (dialect === 'mongodb') {
      onGerarComando(gerarInsertMongo(table, colunas, linhas), `Insert ${table}`)
    } else if (dialect === 'redis') {
      onGerarComando(gerarComandosRedis(table, colunas, linhas), `Comandos ${table}`)
    } else {
      onGerarComando(gerarInsertSql(table, colunas, linhas, dialect ?? 'mysql'), `Insert ${table}`)
    }
  }, [table, onGerarComando, selecionadas, result.columns, valorDe, dialect])

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

      // ⌘F abre a busca da grade. Fica antes da guarda de `selecao` porque
      // procurar não exige nada selecionado — e antes da guarda de foco só
      // quando o foco não está num campo, senão roubaríamos o ⌘F do editor
      // de SQL, onde ele é a busca do Monaco.
      if (
        (evento.metaKey || evento.ctrlKey) &&
        evento.key === 'f' &&
        !digitandoEmCampo(focoAtual(document.activeElement))
      ) {
        evento.preventDefault()
        setBusca((b) => ({ ...b, aberta: true }))
        return
      }

      // Esc limpa a seleção múltipla antes de olhar para `selecao` — são
      // estados independentes, e sem isto o Esc não fazia nada quando havia
      // linha marcada por checkbox mas nenhuma célula em foco (a guarda
      // abaixo teria retornado cedo demais).
      if (
        evento.key === 'Escape' &&
        selecionadas.size > 0 &&
        !digitandoEmCampo(focoAtual(document.activeElement))
      ) {
        setSelecionadas(new Set())
        ultimaMarcada.current = null
        return
      }

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
  }, [selecao, editing, valorDe, abrirEdicao, abrirEdicaoAmpla, result.columns, onNotify, selecionadas])

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
    /*
      Sem coluna nenhuma, dois casos muito diferentes chegam aqui, e dizer a
      mesma coisa nos dois engana:

      - um comando de escrita, que de fato não devolve colunas;
      - uma busca que **não achou nada** — no Mongo, `toGrid([])` não produz
        coluna alguma.

      A segunda dizia "Comando executado com sucesso", que se lê como "deu
      certo, o registro não existe". Foi o que apareceu quando o filtro
      procurava um MSISDN de texto usando número: a busca estava errada, e a
      tela dava um atestado de que estava certa.

      `affectedRows` é o que separa: só comando de escrita o traz.
    */
    const foiEscrita = result.affectedRows != null

    return (
      <div className="results__empty">
        <IconWarning size={22} style={{ color: foiEscrita ? 'var(--success)' : undefined }} />
        <div>
          {foiEscrita ? (
            <>
              Comando executado com sucesso.
              <br />
              <strong>{numberFormat.format(result.affectedRows as number)}</strong> linha(s)
              afetada(s) em {numberFormat.format(result.durationMs)} ms.
            </>
          ) : (
            <>
              Nenhum registro encontrado.
              <br />
              A consulta rodou em {numberFormat.format(result.durationMs)} ms e não trouxe nada.
            </>
          )}
        </div>
      </div>
    )
  }

  const totalPendente = Object.keys(pendentes).length + exclusoesPendentes.size
  const linhas = result.rows.slice(start, end)

  const navegar = (passo: 1 | -1): void => {
    if (achados.length === 0) return
    setBusca((b) => ({ ...b, indice: proximoAchado(b.indice, achados.length, passo) }))
  }

  return (
    <>
      {busca.aberta && (
        <div className="busca-grade">
          <IconSearch size={13} />
          <input
            className="input busca-grade__campo"
            autoFocus
            value={busca.termo}
            placeholder="Buscar nesta página — valor ou nome de coluna"
            onChange={(e) => setBusca((b) => ({ ...b, termo: e.target.value, indice: 0 }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                navegar(e.shiftKey ? -1 : 1)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setBusca({ aberta: false, termo: '', indice: 0 })
                setColunaRealcada(null)
              }
            }}
          />

          {/*
            A contagem diz **onde** procurou, não só quantos achou. Numa tabela
            de 250 mil linhas com 100 carregadas, um "0 resultados" seco seria
            lido como "esse valor não existe no banco" — que é o mesmo engano
            que a exportação cometia.
          */}
          <span className="busca-grade__contagem">
            {busca.termo.trim() ? descreverBusca(achados, busca.indice, result.rows.length) : ''}
          </span>

          <button
            className="icon-btn"
            onClick={() => navegar(-1)}
            disabled={achados.length === 0}
            title="Anterior (⇧↵)"
          >
            ↑
          </button>
          <button
            className="icon-btn"
            onClick={() => navegar(1)}
            disabled={achados.length === 0}
            title="Próximo (↵)"
          >
            ↓
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setBusca({ aberta: false, termo: '', indice: 0 })
              setColunaRealcada(null)
            }}
            title="Fechar (Esc)"
          >
            <IconClose size={13} />
          </button>
        </div>
      )}

      {/*
        Barra de ações da seleção múltipla — só aparece com algo marcado.
        Fica acima da grade, abaixo do filtro (que mora em `TableFilterBar`,
        renderizado por quem chama esta grade).
      */}
      {selecionadas.size > 0 && (
        <div className="grid-selecao">
          <span>
            <strong>{numberFormat.format(selecionadas.size)}</strong>{' '}
            {selecionadas.size === 1 ? 'selecionada' : 'selecionadas'}
          </span>
          <span className="grid-selecao__espaco" />
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => void exportarSelecionadas('csv')}
            title="Salva as linhas marcadas em CSV — abre no Excel"
          >
            <IconDownload size={13} />
            Exportar CSV
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => void exportarSelecionadas('json')}
            title="Salva as linhas marcadas em JSON"
          >
            <IconDownload size={13} />
            Exportar JSON
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={gerarInsertDasSelecionadas}
            disabled={!table || !onGerarComando}
            title={
              !table
                ? 'A origem da linha não foi identificada — sem tabela, não há para onde gerar o comando'
                : dialect === 'mongodb'
                  ? 'Abre um insertOne por linha numa aba de query nova'
                  : dialect === 'redis'
                    ? 'Abre o comando equivalente por linha numa aba de query nova'
                    : 'Abre um INSERT por linha numa aba de query nova'
            }
          >
            <IconStructure size={13} />
            {dialect === 'mongodb'
              ? 'Gerar insertOne'
              : dialect === 'redis'
                ? 'Gerar comandos'
                : 'Gerar INSERT'}
          </button>
          <button className="icon-btn" onClick={limparSelecao} title="Limpar seleção (Esc)">
            <IconClose size={13} />
          </button>
        </div>
      )}

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
                  } ${indice === colunaRealcada ? 'grid__th--realcada' : ''}`}
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
                const selecionadaNoConjunto = selecionadas.has(indiceLinha)
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
                      O número da linha é a caixa de seleção. Clique simples
                      troca a seleção, ⌘/Ctrl soma, Shift marca o intervalo —
                      o gesto de planilha, sem uma coluna de checkbox ocupando
                      espaço. `onMouseDown` casa com o gesto das células: no
                      `click`, a seleção só apareceria ao soltar o botão.
                    */}
                    <div
                      className={`grid__gutter grid__gutter--clicavel ${
                        selecionadaNoConjunto ? 'grid__gutter--selecionada' : ''
                      }`}
                      onMouseDown={(e) =>
                        selecionarLinha(indiceLinha, {
                          shift: e.shiftKey,
                          meta: e.metaKey || e.ctrlKey
                        })
                      }
                      onContextMenu={(e) => {
                        e.preventDefault()
                        // Menu numa linha fora da seleção passa a mirar só ela;
                        // dentro da seleção, preserva o conjunto (agir sobre
                        // várias de uma vez).
                        if (!selecionadaNoConjunto) {
                          selecionarLinha(indiceLinha, { shift: false, meta: false })
                        }
                        setMenu({ x: e.clientX, y: e.clientY, row: indiceLinha, col: 0 })
                      }}
                      title="Clique seleciona a linha · ⌘/Ctrl soma · Shift marca intervalo · ⌘C copia"
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

                      const destino = destinoDaColuna[coluna.name]

                      return (
                        <div
                          key={indiceColuna}
                          className={`grid__cell grid__cell--${valor === null ? 'null' : coluna.type} ${
                            selecionada ? 'grid__cell--selected' : ''
                          } ${aplicando && marca in pendentes ? 'grid__cell--salvando' : ''} ${
                            marca in pendentes ? 'grid__cell--alterada' : ''
                          } ${destino && valor !== null ? 'grid__cell--relacional' : ''} ${
                            indiceColuna === colunaRealcada ? 'grid__cell--coluna-realcada' : ''
                          }`}
                          style={{ width: widths[indiceColuna] }}
                          title={
                            destino && valor !== null
                              ? `${formatarCelula(valor)}\n\nAbrir ${destino.tabela} filtrada por ${destino.coluna} = ${formatarCelula(valor)}${
                                  destino.provavel
                                    ? '\n\nLigação provável: o banco não declara esta chave estrangeira. Deduzida pelo nome da coluna.'
                                    : ''
                                }`
                              : valor === null
                                ? 'NULL'
                                : formatarCelula(valor)
                          }
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

                          {/*
                            Ícone revelado no hover, no canto direito. Fixo em
                            toda célula de chave estrangeira, ele competiria com
                            o dado em milhares de linhas; só no hover, ele diz
                            "aqui dá para ir" exatamente quando a mão já está
                            ali. O `title` acima diz para onde, antes do clique.
                          */}
                          {destino && valor !== null && onAbrirRelacao && (
                            <button
                              className={`grid__ir ${destino.provavel ? 'grid__ir--provavel' : ''}`}
                              tabIndex={-1}
                              aria-label={`Abrir ${destino.tabela}`}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                onAbrirRelacao(destino.tabela, destino.coluna, valor)
                              }}
                            >
                              <IconLink size={12} />
                            </button>
                          )}
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
