/**
 * Passos do tour de primeira conexão, e onde encaixar o cartão de cada um.
 *
 * A parte visual mora no componente; aqui fica o que precisa de teste: quais
 * passos são mostráveis e onde o cartão cabe. Posicionamento é justamente o
 * que quebra em silêncio — o cartão sai da tela e a pessoa vê um destaque
 * apontando para o nada, sem texto nenhum.
 */

export interface PassoDoTour {
  id: string
  /** Valor do `data-tour` do elemento destacado. */
  alvo: string
  titulo: string
  texto: string
}

/**
 * A versão fica no valor guardado, não só na chave.
 *
 * Um dia vai existir um tour novo — recurso novo, tela nova. Guardando só
 * `true`, não haveria como mostrá-lo a quem já viu o antigo sem apagar a
 * marca de todo mundo, o que reexibiria o tour velho para quem acabou de vê-lo.
 */
export const VERSAO_DO_TOUR = 1
export const CHAVE_DO_TOUR = 'vela.tourVisto'

export const PASSOS: PassoDoTour[] = [
  {
    id: 'busca',
    alvo: 'busca',
    titulo: 'Ache a tabela pelo nome — ou pela coluna',
    texto:
      'A busca procura nos nomes das tabelas e também nos das colunas. Serve para quando você lembra do campo, mas não de onde ele mora.'
  },
  {
    id: 'receitas',
    alvo: 'receitas',
    titulo: 'Consultas prontas, quando bate o branco',
    texto:
      'Contar linhas, achar campos vazios, filtrar por período. Clicar insere a consulta no editor já com a sua tabela preenchida — e você escolhe qual, no alto do painel.'
  },
  {
    id: 'historico',
    alvo: 'historico',
    titulo: 'Tudo que você já rodou fica guardado',
    texto:
      'Aquela consulta de duas semanas atrás que você não anotou continua aqui. Dá para buscar pelo texto dela.'
  },
  {
    id: 'preferencias',
    alvo: 'preferencias',
    titulo: 'Limite de linhas, tamanho de página, cor',
    texto:
      'É aqui que você muda quantas linhas uma consulta sem LIMIT traz, e a cor de destaque da interface.'
  },
  {
    id: 'tema',
    alvo: 'tema',
    titulo: 'Claro ou escuro',
    texto: 'Os dois são desenhados à parte, não um invertido do outro.'
  },
  {
    id: 'desconectar',
    alvo: 'desconectar',
    titulo: 'Para sair deste banco',
    texto:
      'Desconecta sem fechar o app. Suas abas continuam onde estavam quando você voltar a esta conexão.'
  }
]

/**
 * Só os passos cujo alvo existe na tela agora.
 *
 * Um passo apontando para elemento ausente destaca o canto superior esquerdo e
 * fala de um botão que a pessoa não encontra — pior do que não ter o passo. O
 * botão de desconectar, por exemplo, só existe com conexão ativa.
 */
export function passosVisiveis(
  passos: PassoDoTour[],
  existe: (alvo: string) => boolean
): PassoDoTour[] {
  return passos.filter((p) => existe(p.alvo))
}

export interface Retangulo {
  x: number
  y: number
  largura: number
  altura: number
}

/**
 * Onde encaixar o cartão em relação ao alvo.
 *
 * Abaixo por padrão, acima quando não cabe embaixo. A posição horizontal é
 * grudada na borda esquerda do alvo e depois **presa dentro da janela** — sem
 * isso, um alvo no canto direito (que é onde ficam os botões da barra de
 * título) joga metade do cartão para fora da tela.
 */
export function posicionarCartao(
  alvo: Retangulo,
  cartao: { largura: number; altura: number },
  janela: { largura: number; altura: number },
  margem = 12
): { x: number; y: number; acima: boolean } {
  const cabeEmbaixo = alvo.y + alvo.altura + margem + cartao.altura <= janela.altura
  const acima = !cabeEmbaixo

  const y = acima ? alvo.y - margem - cartao.altura : alvo.y + alvo.altura + margem

  const xDesejado = alvo.x + alvo.largura / 2 - cartao.largura / 2
  const xMaximo = janela.largura - cartao.largura - margem
  const x = Math.max(margem, Math.min(xDesejado, xMaximo))

  return { x, y: Math.max(margem, y), acima }
}

/** Já viu o tour desta versão? */
export function jaViuOTour(guardado: string | null): boolean {
  const numero = Number(guardado)
  return Number.isFinite(numero) && numero >= VERSAO_DO_TOUR
}
