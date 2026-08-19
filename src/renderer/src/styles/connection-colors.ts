import { PALETAS, acharPaleta, coresDoEditor } from './palettes.ts'

/**
 * Cor de identificação de conexão.
 *
 * ## Uma lista só, não duas
 *
 * A primeira versão disto tinha sete cores próprias, separadas das paletas de
 * acento. O resultado apareceu na primeira vez que alguém usou: conexão
 * marcada de azul, interface violeta. Duas listas de cor competindo pela mesma
 * pergunta — "de que cor é este banco?" — e nenhuma resposta.
 *
 * Agora é uma lista só. **A cor da conexão é a paleta da interface**: escolher
 * azul numa conexão pinta a IDE inteira de azul enquanto ela estiver aberta.
 * A cor deixa de ser um adorno na lista e vira o sinal mais forte que existe
 * de onde você está — impossível de não ver, porque é a tela toda.
 *
 * Reaproveitar as paletas traz de brinde o trabalho de contraste que já foi
 * feito nelas: cada uma tem claridade e tinta resolvidas **por tema**, com
 * mínimo de 3:1 para elemento de interface e 4.5:1 para texto. Uma lista
 * paralela precisaria repetir tudo isso, e nada garantiria que continuassem
 * coerentes.
 *
 * ## Sem cor
 *
 * Conexão sem cor cai no padrão das Preferências, que sai de fábrica em âmbar
 * — a cor da própria logo. É o estado neutro: quem tem um banco só não ganha
 * nada pintando, e a IDE continua parecendo ela mesma.
 *
 * ## Cor não pode ser o único sinal
 *
 * Cada opção tem nome escrito, e o nome da conexão continua sempre ao lado da
 * marca. Quem não distingue os matizes não perde informação nenhuma — a cor
 * acelera quem enxerga a diferença, não substitui o texto para ninguém.
 */

export const CORES_DE_CONEXAO = PALETAS

/** Cor sólida da conexão no tema em uso, para pontos, bordas e faixas. */
export function corDaConexao(
  id: string | undefined,
  tema: 'light' | 'dark'
): string | undefined {
  if (!id) return undefined
  // `acharPaleta` cai na primeira paleta quando o id é desconhecido, o que
  // pintaria uma conexão de âmbar sem ninguém entender por quê. Aqui a
  // ausência precisa continuar sendo ausência.
  if (!PALETAS.some((p) => p.id === id)) return undefined
  const cores = coresDoEditor(id)
  // `coresDoEditor` devolve o hex **sem** `#`, porque as regras de tema do
  // Monaco exigem esse formato. Em CSS isso é cor inválida: a borda e a faixa
  // simplesmente não apareceriam, sem nenhum erro no console.
  return `#${tema === 'dark' ? cores.escuro : cores.claro}`
}

/**
 * A paleta que a interface deve vestir agora.
 *
 * A conexão aberta manda; sem cor nela, vale a preferência do usuário. É esta
 * função que faz a IDE inteira mudar de cor ao trocar de banco.
 */
export function paletaEmVigor(
  corDaConexaoAtiva: string | undefined,
  preferencia: string
): string {
  if (corDaConexaoAtiva && PALETAS.some((p) => p.id === corDaConexaoAtiva)) {
    return corDaConexaoAtiva
  }
  return acharPaleta(preferencia).id
}

/**
 * Sugere uma cor ainda não usada, para a conexão nova já nascer distinguível.
 *
 * Sem isto, a segunda conexão nasceria sem cor e a pessoa só descobriria o
 * recurso por acaso — e ele serve justamente para quando há mais de um banco.
 * Esgotadas as cores, repete: repetir é ruim, ficar sem nenhuma é pior.
 */
export function proximaCorLivre(usadas: (string | undefined)[]): string {
  const ocupadas = new Set(usadas.filter(Boolean))
  return (PALETAS.find((p) => !ocupadas.has(p.id)) ?? PALETAS[0]).id
}
