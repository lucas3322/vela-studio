/**
 * Importamos o núcleo do Monaco e apenas as duas gramáticas que usamos.
 * O pacote completo traz ~90 linguagens e 6 MB de JS: tudo isso seria
 * carregado no start só para termos SQL e JavaScript.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { PALETA_PADRAO, coresDoEditor } from '../styles/palettes'
import { REDIS_COMMANDS } from './sql-docs'

// Contribuições do editor: cada import liga um recurso da UI.
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController'
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding'
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment'
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter'
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/esm/vs/editor/contrib/links/browser/links'
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2'
import 'monaco-editor/esm/vs/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution'
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo'

// Gramáticas: SQL para os bancos relacionais, JavaScript para o shell do Mongo.
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

/**
 * Monaco em Electron não pode buscar worker por URL remota.
 * O `?worker` do Vite empacota o worker como módulo local.
 * Só o worker base é necessário: não usamos análise semântica de TS/JSON.
 */
self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker()
  }
}

/**
 * Redis não tem SQL nem gramática pronta no Monaco. Em vez de herdar o
 * highlighting de SQL — que coloriria `HGETALL` como se fosse uma tabela e
 * mostraria uma sintaxe que não existe em Redis —, registramos uma
 * linguagem própria e mínima: só reconhece nomes de comando e string. Não é
 * um parser, é vocabulário; a tolerância continua sendo a regra aqui.
 */
monaco.languages.register({ id: 'redis' })
monaco.languages.setMonarchTokensProvider('redis', {
  ignoreCase: true,
  keywords: REDIS_COMMANDS,
  tokenizer: {
    root: [
      [/[A-Za-z_][\w.]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/-?\d+(\.\d+)?/, 'number']
    ]
  }
})

/**
 * Temas próprios em vez de vs-dark/vs.
 * Os padrões do Monaco não conversam com nossa paleta: o fundo destoa
 * e a cor de comentário some no tema claro.
 */
/**
 * Define os dois temas do editor com o acento da paleta escolhida.
 *
 * Recebe a paleta em vez de ler CSS porque o Monaco só aceita hex literal nas
 * regras — `hsl()` e custom property não funcionam ali.
 */
export function defineThemes(paletaId = PALETA_PADRAO): void {
  const acento = coresDoEditor(paletaId)

  monaco.editor.defineTheme('vela-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'e8eaed', background: '1f232a' },
      { token: 'keyword', foreground: acento.escuro, fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: acento.escuro, fontStyle: 'bold' },
      // `AND`, `IS`, `NOT`, `NULL` caem aqui. Estavam em cinza — mais apagados
      // que os próprios nomes de coluna, então a lógica da condição recuava
      // enquanto os identificadores avançavam. Mesma cor do keyword, sem
      // negrito: a condição fica visível e o esqueleto da query segue saltando.
      { token: 'operator.sql', foreground: acento.escuro },
      { token: 'string', foreground: '86efac' },
      { token: 'string.sql', foreground: '86efac' },
      { token: 'number', foreground: '7dd3fc' },
      { token: 'comment', foreground: '5b636e', fontStyle: 'italic' },
      { token: 'predefined', foreground: 'c4b5fd' },
      { token: 'identifier', foreground: 'e8eaed' },
      { token: 'delimiter', foreground: '8a939f' },
      { token: 'type', foreground: '7dd3fc' }
    ],
    colors: {
      'editor.background': '#1f232a',
      'editor.foreground': '#e8eaed',
      'editorLineNumber.foreground': '#4d545e',
      'editorLineNumber.activeForeground': '#a2a9b5',
      'editor.selectionBackground': '#3a4150',
      'editor.inactiveSelectionBackground': '#2c323c',
      'editor.lineHighlightBackground': '#00000028',
      'editorCursor.foreground': `#${acento.escuro}`,
      'editorIndentGuide.background1': '#2b3038',
      'editorIndentGuide.activeBackground1': '#3d434d',
      'editorWidget.background': '#262b33',
      'editorWidget.border': '#343a44',
      'editorSuggestWidget.background': '#262b33',
      'editorSuggestWidget.border': '#343a44',
      'editorSuggestWidget.selectedBackground': '#343b46',
      'editorSuggestWidget.highlightForeground': `#${acento.escuro}`,
      'editorHoverWidget.background': '#262b33',
      'editorHoverWidget.border': '#343a44',
      'scrollbarSlider.background': '#ffffff18',
      'scrollbarSlider.hoverBackground': '#ffffff28',
      'scrollbarSlider.activeBackground': '#ffffff38'
    }
  })

  monaco.editor.defineTheme('vela-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '1a1d23', background: 'ffffff' },
      { token: 'keyword', foreground: acento.claro, fontStyle: 'bold' },
      { token: 'keyword.sql', foreground: acento.claro, fontStyle: 'bold' },
      { token: 'operator.sql', foreground: acento.claro },
      { token: 'string', foreground: '15803d' },
      { token: 'string.sql', foreground: '15803d' },
      { token: 'number', foreground: '0369a1' },
      { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
      { token: 'predefined', foreground: '6d28d9' },
      { token: 'identifier', foreground: '1a1d23' },
      { token: 'delimiter', foreground: '64748b' },
      { token: 'type', foreground: '0369a1' }
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1a1d23',
      'editorLineNumber.foreground': '#c2c8d0',
      'editorLineNumber.activeForeground': '#5a6472',
      'editor.selectionBackground': '#fde68a80',
      'editor.lineHighlightBackground': '#00000008',
      'editorCursor.foreground': `#${acento.claro}`,
      'editorIndentGuide.background1': '#eef0f3',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e2e5ea',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e2e5ea',
      'editorSuggestWidget.selectedBackground': '#f1f3f6',
      'editorSuggestWidget.highlightForeground': `#${acento.claro}`,
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e2e5ea'
    }
  })
}

/** Opções compartilhadas: densidade e comportamento iguais em toda aba. */
export const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Monaco, monospace",
  lineHeight: 21,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  padding: { top: 14, bottom: 14 },
  automaticLayout: true,
  tabSize: 2,
  wordWrap: 'on',
  // Sugestão aparece sozinha: quem está aprendendo não sabe que existe Ctrl+Space.
  quickSuggestions: { other: true, comments: false, strings: false },
  // Meio segundo de espera. Sem isso a lista pisca a cada tecla enquanto a
  // pessoa ainda está digitando o nome — vira ruído em vez de ajuda.
  // Ctrl+Space continua abrindo na hora, para quem não quer esperar.
  quickSuggestionsDelay: 500,
  suggestOnTriggerCharacters: true,
  // Enter aceita a sugestão — é o gesto que todo mundo já tem na mão.
  // Tab também aceita; Esc fecha a lista e devolve o Enter para nova linha.
  acceptSuggestionOnEnter: 'on',
  tabCompletion: 'on',
  suggestSelection: 'first',
  snippetSuggestions: 'top',
  /**
   * Desliga a sugestão baseada em palavras do documento.
   *
   * Por padrão o Monaco também sugere qualquer palavra já escrita no editor —
   * então digitar `acc` trazia todo texto solto que contivesse "acc", junto
   * das tabelas e colunas de verdade. É a opção de nível de editor que manda
   * aqui; `suggest.showWords` sozinho não desliga o provedor.
   */
  wordBasedSuggestions: 'off',

  // Mostra o nome da tabela/coluna e o tipo sem precisar abrir o painel lateral.
  suggest: {
    showWords: false,
    insertMode: 'replace',
    filterGraceful: true,
    localityBonus: true,
    shareSuggestSelections: true
  },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false
  },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  renderWhitespace: 'none',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  contextmenu: true,
  bracketPairColorization: { enabled: true }
}

export { monaco }
