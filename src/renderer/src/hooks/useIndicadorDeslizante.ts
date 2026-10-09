import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * Indicador que desliza até o item ativo de um controle segmentado.
 *
 * Trocar o fundo de um botão para o outro é um corte: o olho perde onde
 * estava e precisa procurar onde foi parar. O indicador que desliza conta a
 * história inteira — saiu daqui, chegou ali — e é o que faz o segmentado do
 * macOS parecer um objeto físico, não dois estados de cor.
 *
 * O item ativo é quem tem `data-ativo="true"` dentro do trilho. A medida usa
 * `offsetLeft`/`offsetWidth`, então o trilho precisa ser `position: relative`.
 *
 * A primeira medida não anima: o indicador nasce no lugar. Animar a partir
 * do zero faria toda aba nova "deslizar do nada" ao montar — movimento sem
 * causa, que é justamente o que não queremos.
 */
export function useIndicadorDeslizante<T extends HTMLElement>(
  chave: unknown
): { trilho: React.RefObject<T>; estilo: CSSProperties; pronto: boolean } {
  const trilho = useRef<T>(null)
  const [estilo, setEstilo] = useState<CSSProperties>({ opacity: 0 })
  const [pronto, setPronto] = useState(false)

  useLayoutEffect(() => {
    const el = trilho.current
    if (!el) return

    const medir = (): void => {
      const ativo = el.querySelector<HTMLElement>('[data-ativo="true"]')
      if (!ativo) {
        setEstilo({ opacity: 0 })
        return
      }
      setEstilo({
        width: ativo.offsetWidth,
        height: ativo.offsetHeight,
        transform: `translate(${ativo.offsetLeft}px, ${ativo.offsetTop}px)`,
        opacity: 1
      })
    }

    medir()
    // Liga a transição só depois do primeiro quadro pintado no lugar certo.
    const quadro = requestAnimationFrame(() => setPronto(true))

    // A largura de um item muda sem a do trilho mudar — "Colunas" vira
    // "Colunas (6)" quando o schema chega. Por isso observa cada filho.
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    for (const filho of Array.from(el.children)) observador.observe(filho)

    return () => {
      cancelAnimationFrame(quadro)
      observador.disconnect()
    }
  }, [chave])

  return { trilho, estilo, pronto }
}
