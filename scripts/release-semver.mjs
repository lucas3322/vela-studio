/**
 * Como um commit vira um salto de versão.
 *
 * Vive separado do `release.mjs` porque o `release.mjs` executa ao ser
 * importado (ele É o comando), e essa decisão precisa de teste: ela já errou
 * duas vezes em produção, sempre para o lado silencioso — escolhendo `patch`
 * numa release que a mensagem do commit declarava incompatível.
 */

export const CONVENTIONAL = /^(\w+)(\([^)]*\))?(!)?:\s*(.+)$/

/**
 * Tipos que, sozinhos, já declaram mudança incompatível.
 *
 * O Conventional Commits define só duas formas: o `!` depois do tipo
 * (`feat!:`) e o rodapé `BREAKING CHANGE:` no corpo. Estas duas entram porque
 * foram escritas de verdade neste repositório e o script as engoliu calado:
 * `breaking(tests): ...` saiu como patch, e a versão anterior escreveu
 * `BREAKING CHANGE:` no **assunto** em vez do corpo — também patch.
 *
 * Aceitar o que a pessoa realmente escreve é melhor do que estar tecnicamente
 * certo e versionar errado: a intenção era inequívoca nos dois casos.
 */
export const TIPOS_BREAKING = new Set(['breaking', 'break'])

/**
 * Classifica um commit.
 *
 * `BREAKING[ -]CHANGE` é procurado no assunto **e** no corpo. Antes olhava só
 * o corpo, então quem escrevia a declaração na primeira linha — o lugar mais
 * natural para ela — não era ouvido.
 */
export function classificarCommit(commit) {
  const assunto = commit.subject ?? ''
  const corpo = commit.body ?? ''
  const declarouBreaking = /BREAKING[ -]CHANGE/i.test(`${assunto}\n${corpo}`)

  const match = CONVENTIONAL.exec(assunto)
  if (!match) {
    return { type: null, breaking: declarouBreaking, description: assunto }
  }

  const [, tipoCru, , bang, description] = match
  const type = tipoCru.toLowerCase()

  return {
    type,
    breaking: bang === '!' || declarouBreaking || TIPOS_BREAKING.has(type),
    description
  }
}

/** Salto que o conjunto de commits pede. O argumento explícito sempre vence. */
export function decidirSalto(classificados, forcado) {
  if (forcado) return forcado
  if (classificados.some((c) => c.breaking)) return 'major'
  if (classificados.some((c) => c.type === 'feat')) return 'minor'
  return 'patch'
}

/**
 * Por que o salto foi esse.
 *
 * Existe para a decisão aparecer na tela junto do número. O acidente que
 * motivou isto foi o script imprimir a palavra "breaking" ao lado do commit e,
 * duas linhas acima, anunciar `(patch)` — contradizendo a si mesmo sem que
 * ninguém tivesse como saber qual dos dois valia.
 */
export function explicarSalto(classificados, forcado) {
  if (forcado) return `salto informado no comando`

  const incompativel = classificados.find((c) => c.breaking)
  if (incompativel) {
    return `mudança incompatível declarada em ${incompativel.hash ?? 'um commit'}`
  }

  const novidade = classificados.find((c) => c.type === 'feat')
  if (novidade) return `novidade (feat) em ${novidade.hash ?? 'um commit'}`

  return 'nenhum feat nem mudança incompatível entre os commits'
}
