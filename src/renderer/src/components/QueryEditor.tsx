import { useEffect, useRef } from 'react'
import { DRIVERS } from '@shared/types'
import { monaco, defineThemes, editorOptions } from '../editor/monaco-setup'
import {
  registerHover,
  registerMongoCompletion,
  registerSqlCompletion,
  type SchemaProvider
} from '../editor/completion'
import { formatSql } from '../editor/formatter'
import { sqlParaExecutar } from '../editor/sql-context'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { useRunQuery } from '../hooks/useRunQuery'

let providersRegistered = false

/**
 * O provider de autocomplete é registrado uma vez por linguagem, para sempre.
 * Ele lê o schema por essa referência mutável — assim, trocar de conexão
 * atualiza as sugestões sem recriar nada no Monaco.
 */
const schemaRef: { current: SchemaProvider | undefined } = { current: undefined }

export function QueryEditor({ tabId }: { tabId: string }): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>()
  const resolvedTheme = useAppStore((s) => s.resolvedTheme)
  // A paleta **em vigor**, não a preferida: com a conexão pintando a IDE, o
  // editor precisa seguir a mesma cor ou fica na anterior.
  const paleta = useAppStore((s) => s.paletaEfetiva)
  const connection = useConnectionStore((s) => s.saved.find((c) => c.id === s.activeId))
  const schema = useConnectionStore((s) => s.currentSchema())
  const updateTab = useTabStore((s) => s.updateTab)
  const { run } = useRunQuery()

  const dialect = connection ? DRIVERS[connection.driver].dialect : 'mysql'
  const language = dialect === 'mongodb' ? 'javascript' : 'sql'

  // Mantém a referência do schema em dia para o provider já registrado.
  useEffect(() => {
    schemaRef.current = schema ? { ...schema, dialect } : undefined
  }, [schema, dialect])

  useEffect(() => {
    if (!container.current) return

    if (!providersRegistered) {
      defineThemes(useAppStore.getState().paletaEfetiva)
      registerSqlCompletion(() => schemaRef.current)
      registerMongoCompletion(() => schemaRef.current)
      registerHover(() => schemaRef.current, 'sql')
      registerHover(() => schemaRef.current, 'javascript')
      providersRegistered = true
    }

    const tab = useTabStore.getState().tabs.find((t) => t.id === tabId)
    const editor = monaco.editor.create(container.current, {
      ...editorOptions,
      value: tab?.sql ?? '',
      language,
      theme: resolvedTheme === 'dark' ? 'vela-dark' : 'vela-light'
    })
    editorRef.current = editor

    editor.onDidChangeModelContent(() => {
      updateTab(tabId, { sql: editor.getValue(), dirty: true })
    })

    /**
     * ⌘↵ executa **o statement sob o cursor**, não a aba inteira.
     *
     * É o comportamento de todo editor de SQL sério, e por um bom motivo: uma
     * aba costuma ser um caderno com várias queries, incluindo UPDATEs que
     * ninguém quer disparar sem querer ao rodar um SELECT três linhas acima.
     *
     * Havendo seleção, ela vence — selecionar é uma intenção explícita.
     * Para rodar tudo existe ⌘⇧↵.
     */
    editor.addAction({
      id: 'vela.run',
      label: 'Executar seleção ou statement sob o cursor',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const model = editor.getModel()
        const position = editor.getPosition()
        if (!model || !position) return

        const selection = editor.getSelection()
        const sql = sqlParaExecutar({
          texto: model.getValue(),
          offset: model.getOffsetAt(position),
          selecao: selection && !selection.isEmpty() ? model.getValueInRange(selection) : undefined
        })
        if (sql) void run(sql)
      }
    })

    editor.addAction({
      id: 'vela.runAll',
      label: 'Executar tudo',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => void run(editor.getValue())
    })

    editor.addAction({
      id: 'vela.format',
      label: 'Formatar SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: () => {
        if (language !== 'sql') return
        const model = editor.getModel()
        if (!model) return
        editor.executeEdits('vela.format', [
          { range: model.getFullModelRange(), text: formatSql(model.getValue()) }
        ])
      }
    })

    return () => {
      editor.dispose()
      editorRef.current = undefined
    }
    // Recriamos o editor ao trocar de aba ou de linguagem — o modelo muda junto.
  }, [tabId, language, run, updateTab])

  // Tema e paleta mudam sem recriar o editor. A paleta entra aqui porque as
  // cores do Monaco são hex fixo dentro do tema: trocar de cor exige
  // redefinir os dois temas e reaplicar o atual.
  useEffect(() => {
    defineThemes(paleta)
    monaco.editor.setTheme(resolvedTheme === 'dark' ? 'vela-dark' : 'vela-light')
  }, [resolvedTheme, paleta])

  return <div className="editor-pane__monaco" ref={container} />
}

/**
 * Dispara uma ação do editor ativo.
 *
 * O botão "Executar" e o menu nativo passam por aqui em vez de chamar `run()`
 * direto: assim existe um único lugar que decide o que "executar" significa —
 * a seleção, ou o statement sob o cursor — e os três caminhos nunca divergem.
 * A decisão em si mora em `sqlParaExecutar`, que tem teste.
 */
export function triggerEditorAction(id: 'vela.run' | 'vela.runAll' | 'vela.format'): boolean {
  const editors = monaco.editor.getEditors()
  const editor = editors[editors.length - 1]
  if (!editor) return false
  editor.trigger('vela', id, null)
  return true
}

/** Insere texto na posição do cursor — usado pelas receitas do painel de ajuda. */
export function insertIntoActiveEditor(text: string): void {
  const editors = monaco.editor.getEditors()
  const editor = editors[editors.length - 1]
  if (!editor) return
  const selection = editor.getSelection()
  if (!selection) return
  editor.executeEdits('vela.insert', [{ range: selection, text, forceMoveMarkers: true }])
  editor.focus()
}
