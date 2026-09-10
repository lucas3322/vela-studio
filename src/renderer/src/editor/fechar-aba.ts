/**
 * Quando fechar uma aba precisa de aviso.
 *
 * Uma aba de query fechada leva embora o SQL que estava dentro dela. Se a
 * pessoa escreveu algo e não salvou, esse texto nunca existiu em lugar nenhum
 * além daquela aba — não está no banco, não está no histórico como query
 * salva, e não há desfazer depois do fechamento.
 *
 * A regra é a mesma que a bolinha na aba já usa para sinalizar pendência:
 * é query, foi mexida (`dirty`) e tem conteúdo de verdade. Assim o aviso e o
 * sinal visual nunca discordam — uma aba com bolinha avisa, uma sem bolinha
 * fecha calada.
 *
 * O que NÃO avisa, de propósito:
 * - aba de tabela ou de modelagem: nada do que está nelas foi digitado, é tudo
 *   releitura do banco;
 * - query gerada e não tocada (o "Gerar SELECT" do menu, por exemplo): a
 *   pessoa não escreveu aquilo, e perguntar viraria ruído em cada fechamento;
 * - query salva e sem alteração desde então: já existe fora da aba.
 */
export interface AbaFechavel {
  kind: 'query' | 'table' | 'model'
  dirty: boolean
  sql: string
}

export function precisaAvisarAoFechar(aba: AbaFechavel): boolean {
  if (aba.kind !== 'query') return false
  if (!aba.dirty) return false
  return aba.sql.trim().length > 0
}
