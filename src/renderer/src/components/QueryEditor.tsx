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
      defineThemes()
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

    // ⌘↵ executa tudo; ⌘⇧↵ executa só a seleção. O segundo é o que se usa
    // quando o arquivo tem várias queries e você quer rodar uma.
    editor.addAction({
      id: 'vela.run',
      label: 'Executar query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const selection = editor.getSelection()
        const selected =
          selection && !selection.isEmpty() ? editor.getModel()?.getValueInRange(selection) : undefined
        void run(selected || undefined)
      }
    })

    editor.addAction({
      id: 'vela.runSelection',
      label: 'Executar seleção',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => {
        const selection = editor.getSelection()
        if (!selection || selection.isEmpty()) return
        void run(editor.getModel()?.getValueInRange(selection))
      }
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

  // Tema muda sem recriar o editor.
  useEffect(() => {
    monaco.editor.setTheme(resolvedTheme === 'dark' ? 'vela-dark' : 'vela-light')
  }, [resolvedTheme])

  return <div className="editor-pane__monaco" ref={container} />
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
