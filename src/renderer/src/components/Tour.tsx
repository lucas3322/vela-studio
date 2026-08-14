import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import {
  CHAVE_DO_TOUR,
  PASSOS,
  VERSAO_DO_TOUR,
  passosVisiveis,
  posicionarCartao,
  type PassoDoTour
} from '../editor/tour'
import { IconClose } from './Icons'

/**
 * Apresentação da interface, uma vez só, na primeira conexão.
 *
 * ## Por que na primeira conexão, e não na primeira abertura
 *
 * Antes de conectar, metade do que o tour aponta não existe: não há tabelas
 * para buscar, nem botão de desconectar, nem schema para as receitas usarem.
 * Um tour falando de coisas que a pessoa não vê ensina a ignorá-lo.
 *
 * ## O que ele não faz
 *
 * Não bloqueia. Escape fecha, clicar fora fecha, e tanto terminar quanto pular
 * gravam a mesma marca — porque quem pulou decidiu, e insistir seria castigo.
 *
 * Passo cujo alvo sumiu da tela é descartado antes de começar: destacar o
 * canto superior esquerdo enquanto o texto fala de um botão é pior do que não
 * ter o passo.
 */

const CARTAO = { largura: 340, altura: 172 }

export function Tour({ aoFechar }: { aoFechar: () => void }): React.JSX.Element | null {
  const [indice, setIndice] = useState(0)
  const [passos, setPassos] = useState<PassoDoTour[]>([])
  const [foco, setFoco] = useState<{ x: number; y: number; largura: number; altura: number } | null>(
    null
  )
  const [cartao, setCartao] = useState<{ x: number; y: number; acima: boolean } | null>(null)
  /** Contador de reposicionamento, para quando o layout ainda não resolveu. */
  const [tentativa, setTentativa] = useState(0)

  const encerrar = useCallback(() => {
    localStorage.setItem(CHAVE_DO_TOUR, String(VERSAO_DO_TOUR))
    aoFechar()
  }, [aoFechar])

  // Monta a lista uma vez, no início: se um alvo sumisse no meio do caminho, a
  // numeração mudaria embaixo dos pés de quem está lendo "passo 3 de 6".
  useLayoutEffect(() => {
    const disponiveis = passosVisiveis(PASSOS, (alvo) =>
      Boolean(document.querySelector(`[data-tour="${alvo}"]`))
    )
    if (disponiveis.length === 0) {
      encerrar()
      return
    }
    setPassos(disponiveis)
  }, [encerrar])

  const passo = passos[indice]

  useLayoutEffect(() => {
    if (!passo) return
    const alvo = document.querySelector(`[data-tour="${passo.alvo}"]`)
    if (!alvo) {
      // O alvo sumiu depois de a lista ter sido montada. Pular é melhor do que
      // destacar o nada.
      setIndice((i) => i + 1)
      return
    }

    const caixa = alvo.getBoundingClientRect()
    // Medida degenerada significa layout ainda não resolvido — janela sem
    // dimensão, elemento ainda escondido. Desenhar assim põe o cartão no canto
    // e o destaque fora da tela, apontando para nada. Melhor tentar de novo no
    // quadro seguinte do que mostrar errado.
    if (caixa.width === 0 || caixa.height === 0 || window.innerWidth === 0) {
      const proxima = setTimeout(() => setTentativa((n) => n + 1), 120)
      return () => clearTimeout(proxima)
    }

    const medida = { x: caixa.x, y: caixa.y, largura: caixa.width, altura: caixa.height }
    setFoco(medida)
    setCartao(
      posicionarCartao(medida, CARTAO, { largura: window.innerWidth, altura: window.innerHeight })
    )
  }, [passo, tentativa])

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') encerrar()
      if (evento.key === 'ArrowRight' || evento.key === 'Enter') {
        setIndice((i) => (i + 1 >= passos.length ? (encerrar(), i) : i + 1))
      }
      if (evento.key === 'ArrowLeft') setIndice((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [passos.length, encerrar])

  if (!passo || !foco || !cartao) return null

  const ultimo = indice === passos.length - 1
  const avancar = (): void => (ultimo ? encerrar() : setIndice(indice + 1))

  return (
    <div className="tour" onMouseDown={encerrar}>
      {/*
        O recorte é feito com uma sombra gigante em volta do alvo, em vez de
        quatro divs cobrindo o resto: uma caixa só acompanha qualquer formato
        e não deixa fresta nos cantos.
      */}
      <div
        className="tour__foco"
        style={{
          left: foco.x - 6,
          top: foco.y - 6,
          width: foco.largura + 12,
          height: foco.altura + 12
        }}
      />

      <div
        className="tour__cartao"
        style={{ left: cartao.x, top: cartao.y, width: CARTAO.largura }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="tour__fechar" onClick={encerrar} title="Pular o tour" aria-label="Pular">
          <IconClose size={13} />
        </button>

        <div className="tour__titulo">{passo.titulo}</div>
        <div className="tour__texto">{passo.texto}</div>

        <div className="tour__rodape">
          <span className="tour__contagem">
            {indice + 1} de {passos.length}
          </span>
          <span className="tour__espaco" />
          {indice > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={() => setIndice(indice - 1)}>
              Voltar
            </button>
          )}
          <button className="btn btn--primary btn--sm" onClick={avancar}>
            {ultimo ? 'Entendi' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>
  )
}
