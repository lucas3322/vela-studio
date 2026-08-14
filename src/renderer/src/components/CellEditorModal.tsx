import { useEffect, useMemo, useRef, useState } from 'react'
import type { QueryColumn } from '@shared/types'
import { paraEdicao } from '../editor/cell-value'
import { IconCheck, IconCode, IconWarning } from './Icons'

/**
 * Edição de célula em janela, para valores que não cabem numa linha.
 *
 * A edição no lugar serve para trocar um preço ou corrigir um nome: o campo
 * tem a largura da coluna e uma linha de altura. Um `sap_payload` com 2 KB de
 * JSON nessa caixa é ilegível — dá para digitar, não dá para **ler o que se
 * está digitando**, e ninguém edita bem o que não consegue ver.
 *
 * ## O que esta janela faz que a linha não faz
 *
 * - Altura de verdade, com quebra de linha e rolagem.
 * - Em coluna JSON, formata com um clique e **recusa salvar JSON inválido**.
 *   Deixar passar só adia o erro para o banco, e a mensagem que volta de lá
 *   fala de sintaxe numa posição de byte que ninguém consegue localizar.
 * - Mostra o tamanho, porque um campo com limite de tamanho corta em silêncio.
 *
 * O valor confirmado vai para o mesmo caminho da edição inline: vira alteração
 * **pendente**, não gravação. Quem confirma aqui ainda precisa aplicar.
 */

interface Props {
  coluna: QueryColumn
  /** Valor atual da célula, já com as alterações pendentes aplicadas. */
  valor: unknown
  /** Confirma com um texto, ou com `null` para gravar NULL. */
  onConfirm: (bruto: string | null) => void
  onCancel: () => void
}

const numero = new Intl.NumberFormat('pt-BR')

/** Um texto que representa JSON, mesmo que a coluna não seja declarada assim. */
function pareceJson(texto: string): boolean {
  const limpo = texto.trim()
  if (!limpo.startsWith('{') && !limpo.startsWith('[')) return false
  try {
    JSON.parse(limpo)
    return true
  } catch {
    // Começa como JSON e não fecha: ainda queremos as ferramentas de JSON,
    // porque é justamente aqui que a pessoa precisa ver o erro.
    return true
  }
}

export function CellEditorModal({ coluna, valor, onConfirm, onCancel }: Props): React.JSX.Element {
  // Ver `paraEdicao`: coluna JSON chega como objeto, e `String()` nele daria
  // "[object Object]" — foi assim que a janela abriu dizendo que um JSON
  // perfeitamente válido era inválido.
  const original = paraEdicao(valor)
  const [texto, setTexto] = useState(original)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Foca no fim, não no começo: quem abre para acrescentar não deveria ter
    // que atravessar o conteúdo inteiro antes de escrever.
    const el = area.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onCancel])

  const ehJson = coluna.type === 'json' || pareceJson(texto)

  /** `undefined` quando não há o que validar; string com o problema quando há. */
  const erroDeJson = useMemo(() => {
    if (!ehJson || texto.trim() === '') return undefined
    try {
      JSON.parse(texto)
      return undefined
    } catch (erro) {
      return (erro as Error).message
    }
  }, [ehJson, texto])

  const formatar = (): void => {
    try {
      setTexto(JSON.stringify(JSON.parse(texto), null, 2))
    } catch {
      // O botão fica desabilitado com JSON inválido; se chegou aqui, ignora.
    }
  }

  const mudou = texto !== original
  // JSON inválido em coluna JSON é barrado. Em coluna de texto que só *parece*
  // JSON, não: ali o conteúdo pode legitimamente ser um fragmento.
  const bloqueado = coluna.type === 'json' && erroDeJson !== undefined

  const confirmar = (): void => {
    if (bloqueado) return
    onConfirm(texto)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">{coluna.name}</div>
            <div className="modal__subtitle">
              {coluna.type}
              {valor === null && ' · atualmente NULL'}
            </div>
          </div>
        </div>

        <div className="modal__body">
          <div className="editor-celula__barra">
            {ehJson && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={formatar}
                disabled={erroDeJson !== undefined}
                title={
                  erroDeJson
                    ? 'Corrija o JSON para poder formatá-lo'
                    : 'Reindentar com duas casas'
                }
              >
                <IconCode size={13} />
                Formatar JSON
              </button>
            )}
            <span className="editor-celula__medida">
              {numero.format(texto.length)} caracteres ·{' '}
              {numero.format(texto.split('\n').length)} linhas
            </span>
          </div>

          <textarea
            ref={area}
            className={`input editor-celula__area ${erroDeJson ? 'editor-celula__area--erro' : ''}`}
            value={texto}
            spellCheck={false}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // ⌘↵ confirma. O Enter sozinho precisa quebrar linha: numa caixa
              // de várias linhas, confirmar no Enter tornaria impossível
              // escrever JSON formatado.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                confirmar()
              }
            }}
          />

          {erroDeJson && (
            <div className="editor-celula__erro">
              <IconWarning size={14} />
              <span>
                JSON inválido: {erroDeJson}
                {coluna.type === 'json' && ' — o banco recusaria este valor.'}
              </span>
            </div>
          )}
        </div>

        <div className="modal__footer">
          <button
            className="btn btn--ghost"
            onClick={() => onConfirm(null)}
            title="Grava NULL nesta célula"
          >
            Definir como NULL
          </button>
          <span className="modal__espaco" />
          <button className="btn btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={confirmar}
            disabled={bloqueado || !mudou}
            title={
              bloqueado
                ? 'Corrija o JSON para confirmar'
                : !mudou
                  ? 'Nada foi alterado'
                  : 'Confirmar (⌘↵)'
            }
          >
            <IconCheck size={14} />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
