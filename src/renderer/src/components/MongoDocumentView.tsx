import { useEffect, useMemo, useRef, useState } from 'react'
import {
  campos,
  comoJson,
  type CampoDoDocumento,
  type ValorDoDocumento
} from '../editor/documento-mongo'
import { IconChevronDown, IconChevronRight, IconCopy } from './Icons'

/**
 * O resultado do Mongo desenhado como documento, não como tabela.
 *
 * ## Por que não é a grade com outro CSS
 *
 * A grade é uma tabela: ela tem uma coluna para cada chave que **qualquer**
 * documento do lote trouxe, e preenche com nulo onde o documento não tem
 * aquela chave. Numa coleção sem schema — que é o caso normal no Mongo — isso
 * produz uma tela de 84 colunas em que a maioria das células de cada linha é
 * um `NULL` que o banco nunca gravou.
 *
 * Aqui cada documento mostra só os campos que ele tem, na ordem em que o banco
 * os devolveu, com o tipo do BSON à vista. Ausente é ausente; nulo é nulo.
 *
 * ## Somente leitura, de propósito
 *
 * A edição de documento no Mongo ainda não existe no Vela — a grade também a
 * recusa, com mensagem explícita. Oferecer um campo editável aqui daria a
 * entender que grava.
 */

interface Props {
  documentos: Array<Record<string, unknown>>
  /** Documentos desenhados de uma vez; o resto entra conforme a rolagem. */
  lote?: number
  onNotify?: (mensagem: string, tipo?: 'success' | 'danger' | 'info') => void
}

const LOTE_PADRAO = 20

export function MongoDocumentView({
  documentos,
  lote = LOTE_PADRAO,
  onNotify
}: Props): React.JSX.Element {
  /**
   * Quantos documentos estão desenhados.
   *
   * Um documento de 84 campos vira 84 linhas na tela: desenhar os 1000 de uma
   * página de uma vez são 84 mil elementos e a janela trava. Cresce conforme a
   * rolagem chega no fim, e o rodapé sempre diz quantos de quantos — nunca
   * parece que o resultado acabou quando não acabou.
   */
  const [desenhados, setDesenhados] = useState(lote)
  const sentinela = useRef<HTMLDivElement>(null)

  // Resultado novo (outra página, outro filtro) recomeça do primeiro lote.
  useEffect(() => setDesenhados(lote), [documentos, lote])

  useEffect(() => {
    const alvo = sentinela.current
    if (!alvo || desenhados >= documentos.length) return

    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) {
        setDesenhados((atual) => Math.min(atual + lote, documentos.length))
      }
    })
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [desenhados, documentos.length, lote])

  const visiveis = useMemo(() => documentos.slice(0, desenhados), [documentos, desenhados])

  const copiar = (documento: Record<string, unknown>): void => {
    void navigator.clipboard.writeText(comoJson(documento))
    onNotify?.('Documento copiado.', 'success')
  }

  if (documentos.length === 0) {
    return <div className="results__empty">Nenhum documento.</div>
  }

  return (
    <div className="documentos">
      {visiveis.map((documento, indice) => (
        <Documento
          key={indice}
          numero={indice + 1}
          documento={documento}
          onCopiar={() => copiar(documento)}
        />
      ))}

      <div className="documentos__rodape" ref={sentinela}>
        {desenhados < documentos.length
          ? `${desenhados} de ${documentos.length} documentos — role para ver mais`
          : `${documentos.length} ${documentos.length === 1 ? 'documento' : 'documentos'}`}
      </div>
    </div>
  )
}

function Documento({
  numero,
  documento,
  onCopiar
}: {
  numero: number
  documento: Record<string, unknown>
  onCopiar: () => void
}): React.JSX.Element {
  const linhas = useMemo(() => campos(documento), [documento])

  return (
    <article className="documento">
      <div className="documento__topo">
        <span className="documento__numero">{numero}</span>
        <button
          className="icon-btn documento__copiar"
          onClick={onCopiar}
          title="Copiar o documento em JSON"
          aria-label="Copiar o documento em JSON"
        >
          <IconCopy size={13} />
        </button>
      </div>
      <div className="documento__campos">
        {linhas.map((campo) => (
          <Campo key={campo.chave} campo={campo} nivel={0} />
        ))}
      </div>
    </article>
  )
}

function Campo({ campo, nivel }: { campo: CampoDoDocumento; nivel: number }): React.JSX.Element {
  const [aberto, setAberto] = useState(false)
  const composto = campo.valor.filhos !== undefined
  const vazio = composto && campo.valor.filhos!.length === 0

  return (
    <>
      <div
        className={`documento__linha ${composto && !vazio ? 'documento__linha--composta' : ''}`}
        style={{ paddingLeft: `calc(var(--space-3) + ${nivel} * var(--space-4))` }}
        onClick={composto && !vazio ? () => setAberto((a) => !a) : undefined}
      >
        <span className="documento__seta">
          {composto &&
            !vazio &&
            (aberto ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />)}
        </span>
        <span className="documento__chave selectable">{campo.chave}</span>
        <Valor valor={campo.valor} />
      </div>

      {aberto &&
        campo.valor.filhos?.map((filho) => (
          <Campo key={filho.chave} campo={filho} nivel={nivel + 1} />
        ))}
    </>
  )
}

function Valor({ valor }: { valor: ValorDoDocumento }): React.JSX.Element {
  return (
    <span
      className={`documento__valor documento__valor--${valor.tipo} selectable`}
      title={valor.detalhe}
    >
      {valor.texto}
    </span>
  )
}
