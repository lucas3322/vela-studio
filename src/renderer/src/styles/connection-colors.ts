/**
 * Cores de identificação de conexão.
 *
 * ## Para que serve
 *
 * Distinguir bancos de relance. Numa lista com "BANCO DE PRODUÇÃO" e "BANCO
 * CRM LOCAL", a única diferença é a palavra no meio do nome — e é exatamente
 * nesse tipo de leitura apressada que alguém roda um `DELETE` achando que está
 * no local. A cor não substitui o nome; ela **reforça** o nome, e reforço é o
 * que funciona quando ninguém está lendo com atenção.
 *
 * ## Por que lista fechada, e não um seletor de cor
 *
 * Mesmo motivo das paletas de acento: cor escolhida à mão quebra o contraste.
 * Aqui a marca precisa ser visível sobre `--bg-elevated` no tema escuro e
 * sobre `--bg-sidebar` no claro — duas superfícies muito diferentes, e um
 * mesmo valor raramente serve para as duas. Por isso cada cor tem um valor
 * **por tema**, resolvido e medido: mínimo 3:1 contra a superfície mais
 * difícil de cada um. O teste em `src/tests/connection-colors.test.ts` reprova
 * qualquer valor abaixo disso.
 *
 * ## Por que não dá para depender só da cor
 *
 * Sete cores, por mais separadas que estejam, não são sete sinais para quem
 * não distingue vermelho de verde. Por isso: os matizes ficam a 30° ou mais um
 * do outro **e** variam em claridade, cada cor tem nome escrito no seletor, e
 * o nome da conexão continua sempre ao lado da marca. A cor acelera quem
 * enxerga a diferença; ninguém depende dela.
 *
 * O âmbar ficou de fora de propósito: é o acento padrão da interface, e uma
 * conexão âmbar faria a marca se confundir com a cor da própria IDE.
 */

export interface CorDeConexao {
  id: string
  nome: string
  /** Valor para o tema escuro — medido contra `--bg-elevated` (#262b33). */
  escuro: string
  /** Valor para o tema claro — medido contra `--bg-sidebar` (#f6f7f9). */
  claro: string
}

export const CORES_DE_CONEXAO: CorDeConexao[] = [
  { id: 'vermelho', nome: 'Vermelho', escuro: '#db4d4d', claro: '#d84141' },
  { id: 'laranja', nome: 'Laranja', escuro: '#d88c41', claro: '#bc7127' },
  { id: 'verde', nome: 'Verde', escuro: '#41d880', claro: '#1f9651' },
  { id: 'ciano', nome: 'Ciano', escuro: '#41c6d8', claro: '#21909f' },
  { id: 'azul', nome: 'Azul', escuro: '#477dd9', claro: '#4178d8' },
  { id: 'violeta', nome: 'Violeta', escuro: '#a25ede', claro: '#9141d8' },
  { id: 'rosa', nome: 'Rosa', escuro: '#d94393', claro: '#d84191' }
]

/**
 * A cor de uma conexão no tema em uso, ou `undefined` se ela não tem cor.
 *
 * Conexão sem cor é o padrão e continua válida: quem tem um banco só não ganha
 * nada pintando, e obrigar a escolher seria cerimônia sem retorno.
 *
 * Um id desconhecido — de uma versão futura, ou de um arquivo editado à mão —
 * também devolve `undefined`. A conexão aparece sem marca, que é o pior caso
 * aceitável; pintar de uma cor arbitrária seria pior, porque duas conexões
 * poderiam acabar com a mesma marca sem ninguém entender por quê.
 */
export function corDaConexao(
  id: string | undefined,
  tema: 'light' | 'dark'
): string | undefined {
  if (!id) return undefined
  const cor = CORES_DE_CONEXAO.find((c) => c.id === id)
  if (!cor) return undefined
  return tema === 'dark' ? cor.escuro : cor.claro
}

/**
 * Sugere uma cor ainda não usada, para a conexão nova já nascer distinguível.
 *
 * Sem isto, a segunda conexão nasceria sem cor e a pessoa só descobriria o
 * recurso por acaso — e ele existe justamente para o momento em que há mais de
 * um banco. Esgotadas as sete, volta à primeira: repetir cor é ruim, ficar sem
 * nenhuma é pior.
 */
export function proximaCorLivre(usadas: (string | undefined)[]): string {
  const ocupadas = new Set(usadas.filter(Boolean))
  return (CORES_DE_CONEXAO.find((c) => !ocupadas.has(c.id)) ?? CORES_DE_CONEXAO[0]).id
}
