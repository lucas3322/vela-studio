import { extractTables } from './sql-context.ts'

/**
 * Qual tabela as receitas devem usar.
 *
 * ## O que estava errado
 *
 * A regra era `activeTab?.table ?? schema.tables[0]`. Aba de query não tem
 * `table`, então bastava estar escrevendo uma consulta para cair na **primeira
 * tabela do schema em ordem alfabética** — que quase nunca é a tabela em que a
 * pessoa está pensando.
 *
 * Aconteceu de verdade: com a aba `accounts` aberta ao lado e uma query em
 * foco, a receita "Contar linhas" inseriu
 * `SELECT COUNT(*) FROM account_blacklist_managers`. A query fica com cara de
 * certa, roda sem erro nenhum, e responde sobre outra tabela.
 *
 * ## A regra agora
 *
 * Em ordem, do sinal mais forte para o mais fraco:
 *
 * 1. A tabela que a consulta em foco **menciona** no `FROM`/`JOIN`. É o que a
 *    pessoa está escrevendo agora — não há palpite mais confiável.
 * 2. A aba de tabela ativa.
 * 3. A aba de tabela aberta mais recentemente nesta conexão. Ter `accounts`
 *    aberta é um sinal de intenção; a ordem alfabética do catálogo não é.
 * 4. Nada. Sem sinal, a receita sai com `nome_da_tabela` — um marcador que
 *    ninguém confunde com dado real e que falha na hora se for executado.
 *
 * O quarto caso é uma decisão deliberada: chutar a primeira do catálogo
 * produzia uma consulta **executável e errada**, que é a pior das saídas. Um
 * marcador visível é melhor do que uma resposta sobre a tabela errada.
 */

export interface AbaParaFoco {
  kind: 'query' | 'table' | 'model'
  /** Nome da tabela — só em aba de tabela. */
  table?: string
  sql: string
}

export interface OpcoesDeFoco {
  /** Aba em foco agora, se houver. */
  ativa?: AbaParaFoco
  /** Abas da conexão, na ordem em que foram abertas. */
  abas: AbaParaFoco[]
  /** Tabelas que o banco realmente tem. */
  tabelas: string[]
}

/**
 * Casa um nome escrito na query com o nome real do catálogo.
 *
 * A comparação ignora caixa e o prefixo de schema: quem escreve
 * `FROM public.accounts` ou `FROM ACCOUNTS` está falando da mesma tabela, e
 * devolver o nome como o banco o escreve mantém a receita executável.
 */
function casarComCatalogo(escrito: string, tabelas: string[]): string | undefined {
  const semSchema = escrito.split('.').pop() ?? escrito
  const alvo = semSchema.toLowerCase()
  return tabelas.find((t) => t.toLowerCase() === alvo)
}

export function tabelaEmFoco({ ativa, abas, tabelas }: OpcoesDeFoco): string | undefined {
  // 1. O que a consulta em foco menciona.
  if (ativa?.kind === 'query' && ativa.sql.trim()) {
    for (const referencia of extractTables(ativa.sql)) {
      const conhecida = casarComCatalogo(referencia.name, tabelas)
      if (conhecida) return conhecida
    }
  }

  // 2. A aba de tabela ativa.
  if (ativa?.kind === 'table' && ativa.table) return ativa.table

  // 3. A aba de tabela mais recente.
  for (let i = abas.length - 1; i >= 0; i--) {
    const aba = abas[i]
    if (aba.kind === 'table' && aba.table) return aba.table
  }

  // 4. Sem sinal: melhor um marcador do que a tabela errada.
  return undefined
}
