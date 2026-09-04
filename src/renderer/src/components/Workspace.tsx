import { useCallback, useMemo, useRef, useState } from 'react'
import { DRIVERS, type QueryResult } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore, type Tab } from '../store/tabs'
import { useRunQuery } from '../hooks/useRunQuery'
import { QueryEditor, triggerEditorAction } from './QueryEditor'
import { EditableGrid } from './EditableGrid'
import { origemEditavel } from '../editor/origem-editavel'
import { ErrorPanel } from './ErrorPanel'
import { HelpPanel } from './HelpPanel'
import { TableView } from './TableView'
import { ModelDiagram } from './ModelDiagram'
import { WelcomeScreen } from './WelcomeScreen'
import { ExportChoiceDialog } from './ExportChoiceDialog'
import { descreverExportacao } from '../editor/export-message'
import {
  IconClose,
  IconCode,
  IconDownload,
  IconPlay,
  IconPlus,
  IconSparkle,
  IconStop,
  IconTable
, IconModel } from './Icons'

const numberFormat = new Intl.NumberFormat('pt-BR')

export function Workspace(): React.JSX.Element {
  const connectionId = useConnectionStore((s) => s.activeId)
  const database = useConnectionStore((s) => s.activeDatabase)
  const helpPanelVisible = useAppStore((s) => s.helpPanelVisible)

  const allTabs = useTabStore((s) => s.tabs)
  const activeByConnection = useTabStore((s) => s.activeByConnection)
  const { setActive, closeTab, openQueryTab } = useTabStore()

  // Só as abas desta conexão. Trocar de banco troca o conjunto inteiro,
  // e voltar reencontra tudo como estava.
  const tabs = connectionId ? allTabs.filter((t) => t.connectionId === connectionId) : []
  const activeId = connectionId ? activeByConnection[connectionId] : undefined
  const tab = tabs.find((t) => t.id === activeId) ?? tabs[0]

  // Sem conexão não há o que abrir em aba: a tela inicial ocupa tudo.
  if (!connectionId) {
    return (
      <div className="workspace">
        <WelcomeScreen />
      </div>
    )
  }

  return (
    <div className="workspace">
      <div className="tabbar">
        {tabs.map((item) => (
          <button
            key={item.id}
            className={`tab ${item.id === tab?.id ? 'tab--active' : ''}`}
            onClick={() => setActive(item.id)}
            onAuxClick={(e) => {
              // Botão do meio fecha a aba, como no navegador.
              if (e.button === 1) closeTab(item.id)
            }}
            title={
              item.kind === 'table'
                ? `Tabela ${item.title}`
                : item.kind === 'model'
                  ? `Modelagem — ${item.title}`
                  : item.title
            }
          >
            {/*
              O ícone carrega o tipo da aba; a cor de fundo continua carregando
              "qual está ativa". Pintar toda aba de tabela de âmbar faria os
              dois sinais brigarem — você não saberia se o âmbar quer dizer
              "é tabela" ou "é a aba atual".
            */}
            <span className={`tab__kind tab__kind--${item.kind}`}>
              {item.kind === 'table' ? (
                <IconTable size={13} />
              ) : item.kind === 'model' ? (
                <IconModel size={13} />
              ) : (
                <IconCode size={13} />
              )}
            </span>
            {item.kind === 'query' && item.dirty && item.sql.trim() && <span className="tab__dot" />}
            <span className="tab__label">{item.title}</span>
            <span
              className="tab__close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(item.id)
              }}
            >
              <IconClose size={11} />
            </span>
          </button>
        ))}
        <button
          className="icon-btn"
          style={{ flexShrink: 0 }}
          onClick={() => openQueryTab({ connectionId, database })}
          title="Nova aba de query (⌘T)"
        >
          <IconPlus size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          {!tab ? (
            <div className="results__empty">
              <IconSparkle size={26} />
              <div>
                Nenhuma aba aberta.
                <br />
                Pressione <kbd>⌘</kbd> <kbd>T</kbd> ou clique numa tabela na barra lateral.
              </div>
            </div>
          ) : tab.kind === 'table' ? (
            <TableView key={tab.id} tab={tab} />
          ) : tab.kind === 'model' ? (
            <ModelDiagram key={tab.id} tab={tab} />
          ) : (
            <QueryPane key={tab.id} tabId={tab.id} />
          )}
        </div>
        {helpPanelVisible && <HelpPanel />}
      </div>
    </div>
  )
}

/**
 * A grade do resultado de uma consulta.
 *
 * Quando dá para saber de onde a linha veio, usa a mesma grade editável da aba
 * de tabela — com edição na célula, na janela e exclusão. Quando não dá, usa a
 * mesma grade mesmo assim, só que bloqueada e **dizendo o porquê**: "a consulta
 * junta mais de uma tabela" ensina mais do que uma grade inerte sem explicação.
 *
 * A decisão de quando dá vive em `origemEditavel`, e é deliberadamente
 * conservadora: gravar na tabela errada custa o dado, recusar custa um clique.
 */
function GradeDoResultado({ tab, result }: { tab: Tab; result: QueryResult }): React.JSX.Element {
  const schema = useConnectionStore((s) => s.currentSchema())
  const conexao = useConnectionStore((s) => s.saved.find((c) => c.id === tab.connectionId))
  const notify = useAppStore((s) => s.notify)
  const openQueryTab = useTabStore((s) => s.openQueryTab)
  const { run } = useRunQuery()

  const dialect = conexao ? DRIVERS[conexao.driver].dialect : 'mysql'

  const origem = useMemo(
    () =>
      origemEditavel({
        // O statement do resultado, não o texto inteiro do editor: quem rodou
        // ⌘↵ com o cursor numa consulta editou aquela, não as outras do arquivo.
        sql: result.statement?.trim() || tab.sql,
        colunasDoResultado: result.columns.map((c) => c.name),
        tabelasDoBanco: schema?.tables.map((t) => t.name) ?? [],
        colunasPorTabela: Object.fromEntries(
          Object.entries(schema?.columns ?? {}).map(([t, cols]) => [
            t,
            cols.map((c) => c.name)
          ])
        )
      }),
    [result, tab.sql, schema]
  )

  return (
    <EditableGrid
      result={result}
      table={origem.tabela}
      schemaColumns={origem.tabela ? schema?.columns[origem.tabela] : undefined}
      abaId={tab.id}
      readOnly={!!conexao?.readOnly}
      motivoExterno={origem.motivo}
      onNotify={notify}
      dialect={dialect}
      // "Gerar INSERT" da seleção múltipla só existe quando `origemEditavel`
      // achou uma tabela única de origem — sem ela não há para onde gerar.
      onGerarComando={
        origem.tabela
          ? (sql, titulo) =>
              openQueryTab({ connectionId: tab.connectionId, database: tab.database, sql, title: titulo })
          : undefined
      }
      /*
        Reconsulta depois de gravar. O banco pode ter guardado algo diferente
        do que foi digitado — trigger, coerção de tipo, um varchar que truncou
        — e a tela seguiria mostrando o texto do usuário como se fosse o valor
        real.

        `reloadTab` não serve aqui: ele incrementa um contador que só a aba de
        tabela escuta, então numa aba de query não acontecia nada. Era este o
        bug: o dado ia para o banco e a grade continuava mostrando o de antes.

        Reexecuta **só o statement que produziu esta grade**, nunca o texto
        inteiro do editor. Se houver um INSERT ou UPDATE em outra linha do
        arquivo, rodar tudo de novo o executaria uma segunda vez — recarregar a
        tela não pode ter efeito colateral no banco.
      */
      onApplied={() => void run(result.statement?.trim() || tab.sql)}
      onEditCell={
        origem.tabela
          ? async ({ column, value, keys }) => {
              await window.vela.data.updateCell({
                connectionId: tab.connectionId,
                table: origem.tabela as string,
                database: tab.database ?? undefined,
                column,
                value,
                keys
              })
            }
          : undefined
      }
      onDeleteRow={
        origem.tabela
          ? async (keys) => {
              await window.vela.data.deleteRow({
                connectionId: tab.connectionId,
                table: origem.tabela as string,
                database: tab.database ?? undefined,
                keys
              })
            }
          : undefined
      }
    />
  )
}

/** Editor em cima, resultado embaixo, divisória arrastável entre os dois. */
function QueryPane({ tabId }: { tabId: string }): React.JSX.Element | null {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId))
  const updateTab = useTabStore((s) => s.updateTab)
  const notify = useAppStore((s) => s.notify)
  const openModal = useAppStore((s) => s.openModal)
  const { cancel } = useRunQuery()
  /**
   * Escolha pendente de exportação, quando o resultado veio cortado.
   * `mostrando` guarda em quantas linhas o corte aconteceu, para o diálogo
   * poder dizer o número em vez de "algumas".
   */
  const [exportacao, setExportacao] = useState<{
    format: 'csv' | 'json'
    consulta: string
    nome: string
    mostrando: number
  } | null>(null)

  const editorHeight = useAppStore((s) => s.editorHeight)
  const setEditorHeight = useAppStore((s) => s.setEditorHeight)
  const containerRef = useRef<HTMLDivElement>(null)

  const startDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = editorHeight

      const onMove = (moveEvent: MouseEvent): void => {
        const total = containerRef.current?.clientHeight ?? 800
        const next = Math.min(total - 140, Math.max(90, startHeight + moveEvent.clientY - startY))
        setEditorHeight(next)
      }
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'row-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [editorHeight]
  )

  if (!tab) return null

  const result = tab.results[tab.activeResultIndex]

  /**
   * Exporta o resultado da aba.
   *
   * Quando o resultado veio cortado, exportar o que está na grade grava um
   * pedaço e chama de sucesso — foi assim que uma tabela de 250.000 linhas
   * virava um arquivo de 100. Nesse caso a decisão volta para quem está
   * olhando, em vez de ser tomada em silêncio: refazer a consulta e levar
   * tudo, ou salvar exatamente o recorte visível.
   */
  const exportResult = async (format: 'csv' | 'json'): Promise<void> => {
    if (!result || result.columns.length === 0) return

    const consulta = result.statement?.trim() || tab.sql.trim()
    const nome = tab.title.replace(/[^\w-]/g, '_')

    // Sem corte, o que está na grade **é** o resultado inteiro: exportar
    // direto evita uma pergunta que só teria uma resposta sensata.
    if (!result.truncatedAt) {
      const path = await window.vela.app.exportResult({
        format,
        columns: result.columns.map((c) => c.name),
        rows: result.rows,
        suggestedName: nome
      })
      if (path) notify(descreverExportacao({ arquivos: [path], linhas: result.rows.length }), 'success')
      return
    }

    setExportacao({ format, consulta, nome, mostrando: result.truncatedAt })
  }

  const exportarTudo = async (
    format: 'csv' | 'json',
    consulta: string,
    nome: string
  ): Promise<void> => {
    setExportacao(null)
    try {
      const saida = await window.vela.app.exportQuery({
        connectionId: tab.connectionId,
        sql: consulta,
        database: tab.database ?? undefined,
        format,
        suggestedName: nome
      })
      if (saida) notify(descreverExportacao(saida), 'success')
    } catch (erro) {
      notify(erro instanceof Error ? erro.message : 'Falha ao exportar.', 'danger')
    }
  }

  const exportarVisivel = async (format: 'csv' | 'json', nome: string): Promise<void> => {
    setExportacao(null)
    if (!result) return
    const path = await window.vela.app.exportResult({
      format,
      columns: result.columns.map((c) => c.name),
      rows: result.rows,
      suggestedName: nome
    })
    if (path) notify(descreverExportacao({ arquivos: [path], linhas: result.rows.length }), 'success')
  }

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div className="editor-pane" style={{ height: editorHeight, flexShrink: 0 }}>
        <QueryEditor tabId={tabId} />
      </div>

      <div className="editor-toolbar">
        {tab.running ? (
          <button className="btn btn--secondary btn--sm" onClick={() => void cancel()}>
            <IconStop size={12} />
            Cancelar
          </button>
        ) : (
          <button
            className="btn btn--primary btn--sm"
            onClick={() => triggerEditorAction('vela.run')}
            disabled={!tab.sql.trim()}
            title="⌘↵ — executa o texto selecionado; sem seleção, o statement onde o cursor está. ⌘⇧↵ executa tudo."
          >
            <IconPlay size={12} />
            Executar
          </button>
        )}

        <button
          className="btn btn--secondary btn--sm"
          onClick={() => openModal('saveQuery')}
          disabled={!tab.sql.trim()}
          title="Salvar esta query na barra lateral (⌘S)"
        >
          {tab.savedQueryId ? 'Atualizar' : 'Salvar'}
        </button>

        <span className="editor-toolbar__hint">⌘↵ executa o statement do cursor · ⌘⇧↵ executa tudo</span>

        <div className="editor-toolbar__spacer" />

        {tab.results.length > 1 && (
          <div className="results__tabs" style={{ border: 'none', height: 'auto', padding: 0 }}>
            {tab.results.map((_, index) => (
              <button
                key={index}
                className={`results__tab ${index === tab.activeResultIndex ? 'results__tab--active' : ''}`}
                onClick={() => updateTab(tab.id, { activeResultIndex: index })}
              >
                Resultado {index + 1}
              </button>
            ))}
          </div>
        )}

        {result && result.columns.length > 0 && (
          <>
            <span className="editor-toolbar__hint">
              {numberFormat.format(result.rowCount)} linhas ·{' '}
              {numberFormat.format(result.durationMs)} ms
            </span>
            <button
              className="icon-btn"
              onClick={() => void exportResult('csv')}
              title="Exportar como CSV"
            >
              <IconDownload size={14} />
            </button>
          </>
        )}
      </div>

      {/* A alça precisa ser vista para ser descoberta: uma divisória
          transparente de 5px existe, funciona e ninguém acha. */}
      <div
        className="splitter"
        onMouseDown={startDrag}
        onDoubleClick={() => setEditorHeight(260)}
        title="Arraste para redimensionar · duplo clique volta ao padrão"
      >
        <span className="splitter__alca" />
      </div>

      <div className="results">
        {tab.error && <ErrorPanel error={tab.error} />}

        {tab.running && (
          <div className="results__empty">
            <span className="spinner" />
            Executando…
          </div>
        )}

        {!tab.running && !tab.error && !result && (
          <div className="results__empty">
            <IconSparkle size={26} />
            <div>
              Escreva sua consulta acima e pressione <kbd>⌘</kbd> <kbd>↵</kbd>.
              <br />
              As sugestões aparecem sozinhas conforme você digita.
            </div>
          </div>
        )}

        {!tab.running && result && <GradeDoResultado tab={tab} result={result} />}
      </div>

      {exportacao && (
        <ExportChoiceDialog
          mostrando={exportacao.mostrando}
          formato={exportacao.format}
          onTudo={() => void exportarTudo(exportacao.format, exportacao.consulta, exportacao.nome)}
          onVisivel={() => void exportarVisivel(exportacao.format, exportacao.nome)}
          onCancel={() => setExportacao(null)}
        />
      )}
    </div>
  )
}
