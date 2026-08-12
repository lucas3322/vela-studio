import { useAppStore } from '../store/app'
import { IconWarning } from './Icons'

const numero = new Intl.NumberFormat('pt-BR')

/**
 * Aviso de que o resultado foi cortado.
 *
 * Separa duas coisas que antes vinham juntas na mesma barra âmbar:
 *
 * 1. **Faltam linhas.** É fato, e some do resultado sem deixar rastro. Se a
 *    pessoa somar uma coluna achando que somou a tabela, a conta sai errada e
 *    nada na tela avisa. Por isso continua aparecendo sempre — em voz baixa.
 * 2. **A consulta está pesada.** Isso é conselho, e conselho repetido a cada
 *    execução vira ruído: quem configurou o corte em 1.000 recebia a barra
 *    inteira toda vez, dizendo o que ele mesmo pediu.
 *
 * Acima do limite configurado o aviso ganha o tom de alerta e fala de
 * desempenho. Abaixo, é só uma linha discreta constatando o corte.
 */
export function TruncationNotice({ cortadoEm }: { cortadoEm?: number }): React.JSX.Element | null {
  const limiteAviso = useAppStore((s) => s.limiteAviso)
  if (!cortadoEm) return null

  const pesada = cortadoEm >= limiteAviso

  if (!pesada) {
    return (
      <div className="grid__truncated">
        Mostrando {numero.format(cortadoEm)} linhas — o banco tem mais.
      </div>
    )
  }

  return (
    <div className="grid__truncated grid__truncated--alerta">
      <IconWarning size={14} />
      <span>
        <strong>{numero.format(cortadoEm)} linhas</strong> é muita coisa para trazer de uma vez —
        e ainda há mais no banco. Um <code>LIMIT</code> ou um filtro no{' '}
        <code>WHERE</code> deixam a consulta mais rápida e o resultado mais fácil de ler.
      </span>
    </div>
  )
}
