import { useEffect, useMemo, useRef, useState } from 'react'
import {
  caminhosCompostos,
  campos,
  comoJson,
  previa,
  recortar,
  SEPARADOR_DE_CAMINHO,
  type ValorDoDocumento
} from '../editor/documento-mongo'
import { IconChevronRight, IconCopy, IconExpandir, IconRecolher } from './Icons'

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
  /** Fuso em que as datas aparecem — o mesmo da grade. Ver `fusoDoMongo`. */
  fuso: string
  /** Documentos desenhados de uma vez; o resto entra conforme a rolagem. */
  lote?: number
  onNotify?: (mensagem: string, tipo?: 'success' | 'danger' | 'info') => void
}

const LOTE_PADRAO = 20

export function MongoDocumentView({
  documentos,
  fuso,
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
          fuso={fuso}
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
  fuso,
  onCopiar
}: {
  numero: number
  documento: Record<string, unknown>
  fuso: string
  onCopiar: () => void
}): React.JSX.Element {
  const linhas = useMemo(() => campos(documento, fuso), [documento, fuso])
  const compostos = useMemo(() => caminhosCompostos(linhas), [linhas])

  /*
    O que está aberto mora aqui, por caminho, e não em cada linha: é o que
    deixa "Expandir tudo" abrir o documento inteiro de uma vez. Começa tudo
    recolhido — com a prévia na linha, o recolhido já mostra o conteúdo.
  */
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set())
  /* Blocos mostrados por inteiro, sem o corte de dez. `''` é a raiz. */
  const [inteiros, setInteiros] = useState<Set<string>>(() => new Set())
  const tudoAberto = compostos.length > 0 && compostos.every((c) => abertos.has(c))

  const mostrarInteiro = (caminho: string, inteiro: boolean): void =>
    setInteiros((atuais) => {
      const proximos = new Set(atuais)
      if (inteiro) proximos.add(caminho)
      else proximos.delete(caminho)
      return proximos
    })

  // "Expandir tudo" é pedir o documento inteiro: abre os blocos e tira o corte.
  const expandirTudo = (): void => {
    if (tudoAberto) {
      setAbertos(new Set())
      setInteiros(new Set())
    } else {
      setAbertos(new Set(compostos))
      setInteiros(new Set(['', ...compostos]))
    }
  }

  const raiz = recortar(linhas, inteiros.has(''))

  const alternar = (caminho: string): void =>
    setAbertos((atuais) => {
      const proximos = new Set(atuais)
      if (proximos.has(caminho)) proximos.delete(caminho)
      else proximos.add(caminho)
      return proximos
    })

  return (
    <article className="documento">
      <div className="documento__topo">
        <span className="documento__acoes">
          {compostos.length > 0 && (
            <button
              className="icon-btn"
              onClick={expandirTudo}
              title={tudoAberto ? 'Recolher tudo' : 'Expandir tudo'}
              aria-label={tudoAberto ? 'Recolher tudo' : 'Expandir tudo'}
            >
              {tudoAberto ? <IconRecolher size={13} /> : <IconExpandir size={13} />}
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onCopiar}
            title="Copiar o documento em JSON"
            aria-label="Copiar o documento em JSON"
          >
            <IconCopy size={13} />
          </button>
        </span>
        <span className="documento__numero">#{numero}</span>
      </div>

      <div className="json selectable">
        <Linha nivel={0}>
          <span className="json__pont">{'{'}</span>
        </Linha>
        {raiz.visiveis.map((campo, indice) => (
          <No
            key={campo.chave}
            chave={campo.chave}
            valor={campo.valor}
            nivel={1}
            ultimo={raiz.ocultos === 0 && indice === raiz.visiveis.length - 1}
            caminho={campo.chave}
            comChave
            abertos={abertos}
            alternar={alternar}
            inteiros={inteiros}
            mostrarInteiro={mostrarInteiro}
          />
        ))}
        <VerMais
          nivel={1}
          ocultos={raiz.ocultos}
          total={linhas.length}
          inteiro={inteiros.has('')}
          lista={false}
          onMudar={(inteiro) => mostrarInteiro('', inteiro)}
        />
        <Linha nivel={0}>
          <span className="json__pont">{'}'}</span>
        </Linha>
      </div>
    </article>
  )
}

/**
 * Um valor do documento, escrito como JSON do shell do Mongo.
 *
 * Chave entre aspas, dois-pontos, valor e vírgula — menos no último, como
 * no JSON de verdade. Objeto e lista abrem em várias linhas com as chaves de
 * fechamento no próprio nível; recolhidos, cabem numa linha só com a prévia
 * do conteúdo. Item de lista não leva chave: `0:`, `1:` não existem no JSON.
 */
function No({
  chave,
  valor,
  nivel,
  ultimo,
  caminho,
  comChave,
  abertos,
  alternar,
  inteiros,
  mostrarInteiro
}: {
  chave: string
  valor: ValorDoDocumento
  nivel: number
  ultimo: boolean
  caminho: string
  comChave: boolean
  abertos: Set<string>
  alternar: (caminho: string) => void
  inteiros: Set<string>
  mostrarInteiro: (caminho: string, inteiro: boolean) => void
}): React.JSX.Element {
  const rotulo = comChave ? (
    <>
      <span className="json__chave">{JSON.stringify(chave)}</span>
      <span className="json__pont">: </span>
    </>
  ) : null
  const virgula = ultimo ? null : <span className="json__pont">,</span>

  const filhos = valor.filhos
  if (!filhos) {
    return (
      <Linha nivel={nivel}>
        {rotulo}
        <Literal valor={valor} />
        {virgula}
      </Linha>
    )
  }

  const lista = valor.tipo === 'lista'
  const [abre, fecha] = lista ? ['[', ']'] : ['{', '}']

  if (filhos.length === 0) {
    return (
      <Linha nivel={nivel}>
        {rotulo}
        <span className="json__pont">{abre + fecha}</span>
        {virgula}
      </Linha>
    )
  }

  const aberto = abertos.has(caminho)
  const quantos = lista
    ? `${filhos.length} ${filhos.length === 1 ? 'item' : 'itens'}`
    : `${filhos.length} ${filhos.length === 1 ? 'campo' : 'campos'}`

  if (!aberto) {
    return (
      <Linha nivel={nivel} dobravel aberto={false} onAlternar={() => alternar(caminho)}>
        {rotulo}
        <span className="json__previa">{previa(valor)}</span>
        {virgula}
        <span className="json__contagem">{quantos}</span>
      </Linha>
    )
  }

  const bloco = recortar(filhos, inteiros.has(caminho))

  return (
    <>
      <Linha nivel={nivel} dobravel aberto onAlternar={() => alternar(caminho)}>
        {rotulo}
        <span className="json__pont">{abre}</span>
      </Linha>
      {bloco.visiveis.map((filho, indice) => (
        <No
          key={filho.chave}
          chave={filho.chave}
          valor={filho.valor}
          nivel={nivel + 1}
          ultimo={bloco.ocultos === 0 && indice === bloco.visiveis.length - 1}
          caminho={`${caminho}${SEPARADOR_DE_CAMINHO}${filho.chave}`}
          comChave={!lista}
          abertos={abertos}
          alternar={alternar}
          inteiros={inteiros}
          mostrarInteiro={mostrarInteiro}
        />
      ))}
      <VerMais
        nivel={nivel + 1}
        ocultos={bloco.ocultos}
        total={filhos.length}
        inteiro={inteiros.has(caminho)}
        lista={lista}
        onMudar={(inteiro) => mostrarInteiro(caminho, inteiro)}
      />
      <Linha nivel={nivel}>
        <span className="json__pont">{fecha}</span>
        {virgula}
      </Linha>
    </>
  )
}

/**
 * A linha do corte: "… mais 8 campos" no lugar dos que ficaram de fora, e
 * "mostrar menos" depois que a pessoa abriu tudo. Fica no recuo dos campos,
 * onde estaria o próximo deles — o lugar em que o olho procura o resto.
 */
function VerMais({
  nivel,
  ocultos,
  total,
  inteiro,
  lista,
  onMudar
}: {
  nivel: number
  ocultos: number
  total: number
  inteiro: boolean
  lista: boolean
  onMudar: (inteiro: boolean) => void
}): React.JSX.Element | null {
  // Bloco curto: nunca teve corte, então não há o que mostrar nem esconder.
  if (ocultos === 0 && !(inteiro && recortar(Array(total), false).ocultos > 0)) return null
  const unidade = lista ? (ocultos === 1 ? 'item' : 'itens') : ocultos === 1 ? 'campo' : 'campos'
  return (
    <Linha nivel={nivel}>
      <button className="json__mais" onClick={() => onMudar(ocultos > 0)}>
        {ocultos > 0 ? `… ver mais ${ocultos} ${unidade}` : 'mostrar menos'}
      </button>
    </Linha>
  )
}

function Linha({
  nivel,
  dobravel = false,
  aberto = false,
  onAlternar,
  children
}: {
  nivel: number
  dobravel?: boolean
  aberto?: boolean
  onAlternar?: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`json__linha ${dobravel ? 'json__linha--dobravel' : ''}`}
      style={{ '--nivel': nivel } as React.CSSProperties}
      onClick={onAlternar}
    >
      {nivel > 0 && <span className="json__guias" aria-hidden />}
      {dobravel && (
        <span className={`json__dobra ${aberto ? 'json__dobra--aberta' : ''}`} aria-hidden>
          <IconChevronRight size={10} />
        </span>
      )}
      {children}
    </div>
  )
}

function Literal({ valor }: { valor: ValorDoDocumento }): React.JSX.Element {
  const pedacos = valor.literal ?? [{ classe: 'texto' as const, texto: valor.texto }]
  return (
    <span className="json__valor" title={valor.detalhe}>
      {pedacos.map((pedaco, indice) => (
        <span key={indice} className={`json__${pedaco.classe}`}>
          {pedaco.texto}
        </span>
      ))}
    </span>
  )
}
