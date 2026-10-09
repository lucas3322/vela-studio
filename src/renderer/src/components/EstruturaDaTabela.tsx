import { useEffect, useMemo } from 'react'
import type { ColumnInfo, IndexInfo, RelationInfo } from '@shared/types'
import { useConnectionStore } from '../store/connections'
import {
  categoriaDoTipo,
  chavesSemIndice,
  explicarAcaoReferencial,
  nomeDeIndice,
  type CategoriaDeTipo
} from '../editor/estrutura'
import {
  IconArrowRight,
  IconBinary,
  IconBolt,
  IconBraces,
  IconCalendar,
  IconColumn,
  IconHash,
  IconKey,
  IconLink,
  IconTable,
  IconText,
  IconToggle,
  IconWarning
} from './Icons'

/*
 * A ficha da tabela: Colunas, Índices e Relações.
 *
 * Antes eram três tabelas HTML cruas — cabeçalho em caixa alta e linhas
 * iguais, onde a chave primária e uma coluna de observação tinham o mesmo
 * peso visual. Aqui cada coluna é uma linha de lista agrupada, como nos
 * Ajustes do macOS: o glifo diz a família do tipo de longe, o nome lidera, e
 * o que é exceção (chave, obrigatório, padrão) aparece como selo à direita.
 */

const numero = new Intl.NumberFormat('pt-BR')

const GLIFOS: Record<CategoriaDeTipo, (p: { size: number }) => React.JSX.Element> = {
  numero: IconHash,
  texto: IconText,
  data: IconCalendar,
  booleano: IconToggle,
  json: IconBraces,
  binario: IconBinary,
  outro: IconColumn
}

const NOMES_DE_CATEGORIA: Record<CategoriaDeTipo, string> = {
  numero: 'número',
  texto: 'texto',
  data: 'data e hora',
  booleano: 'verdadeiro ou falso',
  json: 'estrutura (JSON)',
  binario: 'binário',
  outro: 'outro tipo'
}

function Glifo({ coluna }: { coluna: ColumnInfo }): React.JSX.Element {
  if (coluna.isPrimaryKey) {
    return (
      <span className="ficha__glifo ficha__glifo--chave" title="Chave primária">
        <IconKey size={14} />
      </span>
    )
  }
  const categoria = categoriaDoTipo(coluna.type)
  const Desenho = GLIFOS[categoria]
  return (
    <span className={`ficha__glifo ficha__glifo--${categoria}`} title={NOMES_DE_CATEGORIA[categoria]}>
      <Desenho size={14} />
    </span>
  )
}

// ── Cabeçalho comum aos três painéis ──────────────────────────────────

function Cabecalho({
  table,
  columns,
  relations,
  rowCount
}: {
  table: string
  columns: ColumnInfo[]
  relations: RelationInfo[]
  rowCount?: number | null
}): React.JSX.Element {
  const chaves = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  return (
    <header className="ficha__cabeca">
      <span className="ficha__icone">
        <IconTable size={20} />
      </span>
      <div className="ficha__titulos">
        <h2 className="ficha__titulo selectable">{table}</h2>
        <div className="ficha__resumo">
          <span>{columns.length === 1 ? '1 coluna' : `${columns.length} colunas`}</span>
          {rowCount != null && rowCount > 0 && <span>~{numero.format(rowCount)} linhas</span>}
          {chaves.length > 0 && (
            <span>
              chave primária <code>{chaves.join(', ')}</code>
            </span>
          )}
          {relations.length > 0 && (
            <span>{relations.length === 1 ? '1 ligação' : `${relations.length} ligações`}</span>
          )}
        </div>
      </div>
    </header>
  )
}

// ── Colunas ───────────────────────────────────────────────────────────

export function PainelColunas(props: {
  table: string
  columns: ColumnInfo[]
  relations: RelationInfo[]
  rowCount?: number | null
  /** O tipo é editável no TableView (duplo clique); a ficha só posiciona. */
  renderTipo: (coluna: ColumnInfo) => React.ReactNode
  onAbrirTabela: (tabela: string) => void
  /** Mongo e Redis não têm "obrigatório": o campo existe ou não no documento. */
  semSchema: boolean
}): React.JSX.Element {
  const { columns, relations, renderTipo, onAbrirTabela, semSchema } = props
  const destinoPorColuna = useMemo(() => {
    const mapa: Record<string, RelationInfo> = {}
    for (const r of relations) mapa[r.column] = r
    return mapa
  }, [relations])

  return (
    <div className="ficha">
      <Cabecalho {...props} />

      <div className="ficha__grupo">
        {columns.map((coluna) => {
          const destino = destinoPorColuna[coluna.name]
          return (
            <div key={coluna.name} className="ficha__linha">
              <Glifo coluna={coluna} />
              <div className="ficha__corpo">
                <div className="ficha__nome-linha">
                  <span className="ficha__nome selectable">{coluna.name}</span>
                  <span className="ficha__tipo">{renderTipo(coluna)}</span>
                </div>
                {(coluna.comment || coluna.frequency != null) && (
                  <div className="ficha__nota">
                    {coluna.comment ?? `presente em ${coluna.frequency}% dos documentos`}
                  </div>
                )}
              </div>

              <div className="ficha__selos">
                {coluna.isPrimaryKey && <span className="selo selo--chave">chave primária</span>}
                {destino && (
                  <button
                    className="selo selo--ligacao"
                    onClick={() => onAbrirTabela(destino.referencedTable)}
                    title={`Abrir ${destino.referencedTable}`}
                  >
                    <IconLink size={11} />
                    {destino.referencedTable}.{destino.referencedColumn}
                  </button>
                )}
                {coluna.extra && <span className="selo selo--mono">{coluna.extra}</span>}
                {coluna.defaultValue != null && coluna.defaultValue !== '' && (
                  <span className="selo selo--mono" title="Valor quando o INSERT não informa a coluna">
                    padrão {coluna.defaultValue}
                  </span>
                )}
                {!semSchema && !coluna.isPrimaryKey && (
                  <span
                    className={`selo ${coluna.nullable ? '' : 'selo--forte'}`}
                    title={coluna.nullable ? 'Aceita NULL' : 'NOT NULL: o banco recusa a linha sem este valor'}
                  >
                    {coluna.nullable ? 'opcional' : 'obrigatória'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Índices ───────────────────────────────────────────────────────────

export function PainelIndices(props: {
  table: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  relations: RelationInfo[]
  rowCount?: number | null
  /** Só bancos SQL recebem a sugestão de índice — Mongo e Redis não têm FK. */
  sugerir: boolean
  quote: (nome: string) => string
  onGerarSql: (sql: string, titulo: string) => void
}): React.JSX.Element {
  const { table, columns, indexes, relations, sugerir, quote, onGerarSql } = props
  const faltando = useMemo(
    () =>
      sugerir
        ? chavesSemIndice(
            relations,
            indexes,
            columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
          )
        : [],
    [sugerir, relations, indexes, columns]
  )

  return (
    <div className="ficha">
      <Cabecalho {...props} />

      {/*
        A sugestão vem antes da lista porque é a única coisa aqui que pede uma
        decisão. Ela não cria nada: gera o comando numa aba nova, para a
        pessoa ler, entender e rodar — índice em tabela grande trava escrita.
      */}
      {faltando.map((coluna) => (
        <div key={coluna} className="ficha__sugestao">
          <IconWarning size={15} />
          <div className="ficha__sugestao-texto">
            <strong>
              <code>{coluna}</code> é chave estrangeira e não tem índice.
            </strong>
            <span>Todo JOIN ou filtro por ela percorre a tabela inteira.</span>
          </div>
          <button
            className="btn btn--secondary btn--sm btn--acento"
            onClick={() =>
              onGerarSql(
                `-- Índice para a chave estrangeira ${coluna}.\n-- Em tabela grande, criar índice bloqueia escrita enquanto roda.\nCREATE INDEX ${quote(nomeDeIndice(table, coluna))}\n  ON ${quote(table)} (${quote(coluna)});\n`,
                `Índice em ${coluna}`
              )
            }
          >
            Gerar CREATE INDEX
          </button>
        </div>
      ))}

      {indexes.length === 0 ? (
        <div className="ficha__vazio">
          <span className="ficha__vazio-icone">
            <IconBolt size={20} />
          </span>
          <strong>Nenhum índice além da chave primária</strong>
          <span>
            Índice é o sumário da tabela: deixa o banco ir direto às linhas de um WHERE ou JOIN em
            vez de ler todas.
          </span>
        </div>
      ) : (
        <div className="ficha__grupo">
          {indexes.map((indice) => (
            <div key={indice.name} className="ficha__linha">
              <span className={`ficha__glifo ${indice.primary ? 'ficha__glifo--chave' : 'ficha__glifo--indice'}`}>
                {indice.primary ? <IconKey size={14} /> : <IconBolt size={14} />}
              </span>
              <div className="ficha__corpo">
                <div className="ficha__nome-linha">
                  <span className="ficha__nome selectable">{indice.name}</span>
                </div>
                <div className="ficha__colunas">
                  {indice.columns.map((coluna, posicao) => (
                    <span key={coluna + posicao} className="ficha__coluna-chip">
                      {coluna}
                    </span>
                  ))}
                </div>
              </div>
              <div className="ficha__selos">
                {indice.primary && <span className="selo selo--chave">primário</span>}
                {indice.unique && !indice.primary && (
                  <span className="selo selo--forte" title="O banco recusa dois registros com o mesmo valor">
                    único
                  </span>
                )}
                {indice.columns.length > 1 && <span className="selo">composto</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Relações ──────────────────────────────────────────────────────────

export function PainelRelacoes(props: {
  table: string
  columns: ColumnInfo[]
  relations: RelationInfo[]
  rowCount?: number | null
  /** Texto do vazio, que muda por banco (Mongo e Redis não declaram FK). */
  avisoSemRelacoes?: string
  onAbrirTabela: (tabela: string) => void
}): React.JSX.Element {
  const { table, relations, avisoSemRelacoes, onAbrirTabela } = props

  /*
    Quem aponta para esta tabela. A FK é declarada do outro lado, então
    a consulta da tabela não a traz; vem das relações do banco inteiro, que
    o store carrega sob demanda e a modelagem também usa.
  */
  const schema = useConnectionStore((s) => s.currentSchema())
  const loadRelations = useConnectionStore((s) => s.loadRelations)
  useEffect(() => {
    void loadRelations()
  }, [loadRelations])
  const entrando = useMemo(
    () => (schema?.relations ?? []).filter((r) => r.referencedTable === table && r.table !== undefined),
    [schema, table]
  )

  const vazio = relations.length === 0 && entrando.length === 0

  return (
    <div className="ficha">
      <Cabecalho {...props} />

      {vazio && (
        <div className="ficha__vazio">
          <span className="ficha__vazio-icone">
            <IconLink size={20} />
          </span>
          <strong>Nenhuma chave estrangeira declarada</strong>
          <span>{avisoSemRelacoes ?? 'Nem esta tabela aponta para outra, nem outra aponta para ela.'}</span>
        </div>
      )}

      {relations.length > 0 && (
        <section className="ficha__secao">
          <h3 className="ficha__secao-titulo">Esta tabela aponta para</h3>
          <div className="ficha__grupo">
            {relations.map((r) => (
              <div key={r.constraintName + r.column} className="ficha__linha ligacao">
                <code className="ligacao__coluna">{r.column}</code>
                <IconArrowRight size={14} className="ligacao__seta" />
                <button
                  className="ligacao__alvo"
                  onClick={() => onAbrirTabela(r.referencedTable)}
                  title={`Abrir ${r.referencedTable}`}
                >
                  <IconTable size={13} />
                  {r.referencedTable}
                  <span>.{r.referencedColumn}</span>
                </button>
                <div className="ficha__selos">
                  <span className="selo" title={`ON DELETE ${r.onDelete ?? 'NO ACTION'}`}>
                    ao excluir lá: {explicarAcaoReferencial(r.onDelete, 'excluir')}
                  </span>
                  <span className="selo" title={`ON UPDATE ${r.onUpdate ?? 'NO ACTION'}`}>
                    ao alterar: {explicarAcaoReferencial(r.onUpdate, 'atualizar')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {entrando.length > 0 && (
        <section className="ficha__secao">
          <h3 className="ficha__secao-titulo">Apontam para esta tabela</h3>
          <div className="ficha__grupo">
            {entrando.map((r) => (
              <div key={r.table + r.constraintName + r.column} className="ficha__linha ligacao">
                <button
                  className="ligacao__alvo"
                  onClick={() => onAbrirTabela(r.table)}
                  title={`Abrir ${r.table}`}
                >
                  <IconTable size={13} />
                  {r.table}
                  <span>.{r.column}</span>
                </button>
                <IconArrowRight size={14} className="ligacao__seta" />
                <code className="ligacao__coluna">{r.referencedColumn}</code>
                <div className="ficha__selos">
                  <span className="selo" title={`ON DELETE ${r.onDelete ?? 'NO ACTION'}`}>
                    ao excluir aqui: {explicarAcaoReferencial(r.onDelete, 'excluir')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
