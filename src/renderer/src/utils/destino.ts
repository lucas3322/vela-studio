import type { ConnectionConfig } from '@shared/types'

/**
 * Para onde a conexão vai, em texto curto, para a lista e a barra lateral.
 *
 * Existe porque os dois lugares montavam o texto a partir de `host` e `port`,
 * e uma conexão por string guarda o endereço **dentro da string** — os campos
 * de host ficam com o padrão do formulário, que o driver ignora. Uma conexão
 * para `db.interno:6543` aparecia como `localhost:5432`.
 *
 * O túnel SSH entra no texto porque muda para onde a conexão de fato vai; é
 * uma configuração que decide o comportamento e não pode ficar invisível.
 *
 * Credencial nunca aparece: da string só sai o que vem depois do `@`.
 */
export function destinoDaConexao(
  conexao: Pick<ConnectionConfig, 'driver' | 'host' | 'port' | 'database' | 'filePath' | 'connectionString' | 'ssh'>,
  opcoes: { comBanco?: boolean } = {}
): string {
  if (conexao.driver === 'sqlite') return conexao.filePath ?? 'local'

  let endereco: string
  const string = conexao.connectionString?.trim()
  if (string) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#]*@)?([^/?#]*)(\/[^?#]*)?/i.exec(string)
    const hosts = m?.[1] || 'localhost'
    const banco = m?.[2]?.replace(/^\//, '')
    endereco = opcoes.comBanco && banco ? `${hosts}/${banco}` : hosts
  } else {
    endereco = `${conexao.host || 'localhost'}${conexao.port ? `:${conexao.port}` : ''}`
    if (opcoes.comBanco && conexao.database) endereco += `/${conexao.database}`
  }

  return conexao.ssh?.enabled && conexao.ssh.host ? `${endereco} · túnel ${conexao.ssh.host}` : endereco
}
