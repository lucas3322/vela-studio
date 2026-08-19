import { DRIVERS, type StoredConnection } from '@shared/types'
import { useAppStore } from '../store/app'
import { corDaConexao } from '../styles/connection-colors'
import { IconDatabase, IconEdit, IconTrash } from './Icons'

interface Props {
  connection: StoredConnection
  onOpen: () => void
  onEdit?: () => void
  onRemove?: () => void
  disabled?: boolean
}

/**
 * Uma conexão salva, na lista.
 *
 * Editar e remover ficam **dentro** do cartão, revelados ao passar o mouse.
 * Fora dele, cada linha carregava dois ícones sempre visíveis competindo com
 * o nome da conexão — que é o que a pessoa está procurando.
 *
 * Um `<button>` não pode conter outros botões, então o cartão é uma `<div>`
 * com o botão de abrir ocupando a área toda e as ações sobrepostas à direita.
 *
 * As ações também aparecem no `:focus-within`: revelar só no hover deixaria
 * quem navega por teclado sem acesso a elas.
 */
export function ConnectionRow({
  connection,
  onOpen,
  onEdit,
  onRemove,
  disabled
}: Props): React.JSX.Element {
  const temAcoes = !!onEdit || !!onRemove
  const tema = useAppStore((s) => s.resolvedTheme)
  const cor = corDaConexao(connection.color, tema)
  const destino =
    connection.filePath ??
    `${connection.host ?? 'localhost'}${connection.port ? `:${connection.port}` : ''}${
      connection.database ? `/${connection.database}` : ''
    }`

  return (
    /*
      A faixa colorida entra como variável CSS, não como cor no elemento: assim
      a borda, o ícone e o realce de hover puxam do mesmo lugar, e uma conexão
      sem cor simplesmente não define a variável — caindo no valor neutro do
      CSS, sem nenhum ramo condicional espalhado pela marcação.
    */
    <div
      className={`conexao ${temAcoes ? 'conexao--com-acoes' : ''} ${cor ? 'conexao--colorida' : ''}`}
      style={cor ? ({ '--cor-conexao': cor } as React.CSSProperties) : undefined}
    >
      <button className="conexao__abrir" onClick={onOpen} disabled={disabled}>
        <IconDatabase
          size={17}
          style={{ color: cor ?? 'var(--accent)', flexShrink: 0 }}
          aria-hidden
        />
        <span className="conexao__corpo">
          <span className="conexao__nome">{connection.name}</span>
          <span className="conexao__destino">{destino}</span>
        </span>
        <span className="badge conexao__driver">{DRIVERS[connection.driver].label.split(' ')[0]}</span>
      </button>

      {temAcoes && (
        <div className="conexao__acoes">
          {onEdit && (
            <button
              className="icon-btn"
              title={`Editar ${connection.name}`}
              aria-label={`Editar ${connection.name}`}
              onClick={onEdit}
            >
              <IconEdit size={14} />
            </button>
          )}
          {onRemove && (
            <button
              className="icon-btn icon-btn--danger"
              title={`Remover ${connection.name}`}
              aria-label={`Remover ${connection.name}`}
              onClick={onRemove}
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
