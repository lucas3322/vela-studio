import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/types'
import { useAppStore } from '../store/app'
import { IconClose, IconDownload } from './Icons'

/**
 * Aviso de versão nova, no canto da tela.
 *
 * Substitui o toast que existia antes. Um toast some sozinho em poucos
 * segundos: quem estava lendo uma query no momento em que ele apareceu nunca
 * soube que havia atualização, e a checagem só voltava a rodar 24 horas
 * depois. Este cartão fica até a pessoa responder.
 *
 * ## Por que ele não volta a incomodar
 *
 * "Agora não" guarda **a versão dispensada**, não um "já vi". Assim o aviso
 * cala sobre a 0.19.0 para sempre, e volta a falar quando sair a 0.20.0 — que
 * é a única leitura honesta de quem clicou ali: recusou aquela atualização,
 * não todas as futuras.
 *
 * O texto está em inglês a pedido do dono do projeto; o resto do app é em
 * português.
 */

const VERSAO_DISPENSADA = 'vela.updateDispensado'

export function UpdateBanner(): React.JSX.Element | null {
  const openModal = useAppStore((s) => s.openModal)
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [saindo, setSaindo] = useState(false)

  useEffect(() => {
    // Depois do primeiro render: competir com a abertura do app faria a
    // janela demorar a aparecer por causa de uma chamada de rede opcional.
    const agendado = setTimeout(() => {
      void window.vela.update.check().then((resultado) => {
        if (resultado.status !== 'disponivel' && resultado.status !== 'sem-arquivo') return
        if (localStorage.getItem(VERSAO_DISPENSADA) === resultado.versaoNova) return
        setInfo(resultado)
      })
    }, 3000)
    return () => clearTimeout(agendado)
  }, [])

  if (!info) return null

  const dispensar = (): void => {
    if (info.versaoNova) localStorage.setItem(VERSAO_DISPENSADA, info.versaoNova)
    setSaindo(true)
    // Deixa a animação de saída terminar antes de desmontar; remover na hora
    // faz o cartão sumir num piscar, que lê como falha.
    setTimeout(() => setInfo(null), 180)
  }

  const baixar = (): void => {
    setSaindo(true)
    setTimeout(() => setInfo(null), 180)
    openModal('update')
  }

  return (
    <div className={`aviso-versao ${saindo ? 'aviso-versao--saindo' : ''}`} role="status">
      <button
        className="aviso-versao__fechar"
        onClick={dispensar}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <IconClose size={13} />
      </button>

      <div className="aviso-versao__texto">
        A new version is available. Download now?
        {info.versaoNova && <span className="aviso-versao__versao">v{info.versaoNova}</span>}
      </div>

      <div className="aviso-versao__acoes">
        <button className="btn btn--secondary btn--sm" onClick={dispensar}>
          Not now
        </button>
        <button className="btn btn--primary btn--sm" onClick={baixar}>
          <IconDownload size={13} />
          Download
        </button>
      </div>
    </div>
  )
}
