/**
 * Decisões puras da atualização: qual versão é mais nova e qual arquivo baixar.
 *
 * Vive separado de `updater.ts` porque este arquivo não importa `electron` —
 * é o que permite testá-lo com `node --test`, sem subir o app. E é a parte que
 * precisa de teste: escolher o asset errado significa entregar ao usuário um
 * instalador de outra arquitetura, que instala, abre e falha dizendo que o app
 * está danificado.
 */

export interface AssetGitHub {
  name: string
  browser_download_url: string
  size: number
}

/**
 * Escolhe o instalador da plataforma **e da arquitetura** corretas.
 *
 * Não existe fallback para "qualquer .dmg": um DMG arm64 com binário x86_64
 * dentro é exatamente o pacote que já quebrou nas mãos de um usuário deste
 * projeto. Sem o arquivo certo devolvemos `undefined`, e a UI manda a pessoa
 * para a página da release em vez de adivinhar.
 */
export function escolherAsset(
  assets: AssetGitHub[],
  plataforma: NodeJS.Platform,
  arquitetura: string
): AssetGitHub | undefined {
  const termina = (asset: AssetGitHub, extensao: string): boolean =>
    asset.name.toLowerCase().endsWith(extensao)
  const contem = (asset: AssetGitHub, trecho: string): boolean =>
    asset.name.toLowerCase().includes(trecho)

  if (plataforma === 'darwin') {
    return assets.find((a) => termina(a, '.dmg') && contem(a, arquitetura.toLowerCase()))
  }
  if (plataforma === 'win32') {
    return (
      assets.find((a) => contem(a, 'setup') && termina(a, '.exe')) ??
      assets.find((a) => contem(a, 'portable') && termina(a, '.exe'))
    )
  }
  if (plataforma === 'linux') {
    return assets.find((a) => termina(a, '.appimage'))
  }
  return undefined
}

/**
 * Compara duas versões semânticas. Devolve > 0 se `a` é mais nova que `b`.
 *
 * Pré-lançamento perde do lançamento final: `0.3.0-beta.1` < `0.3.0`. Sem essa
 * regra, comparar só os números faria as duas empatarem, e quem instalasse um
 * beta nunca seria avisado da versão estável que veio depois.
 */
export function compararVersoes(a: string, b: string): number {
  const esquerda = partir(a)
  const direita = partir(b)

  for (let i = 0; i < 3; i++) {
    const diferenca = (esquerda.nucleo[i] ?? 0) - (direita.nucleo[i] ?? 0)
    if (diferenca !== 0) return diferenca
  }

  if (esquerda.pre === direita.pre) return 0
  if (!esquerda.pre) return 1
  if (!direita.pre) return -1
  return esquerda.pre < direita.pre ? -1 : 1
}

function partir(versao: string): { nucleo: number[]; pre: string } {
  const [nucleo, ...resto] = normalizarVersao(versao).split('-')
  return {
    nucleo: nucleo.split('.').map((parte) => Number.parseInt(parte, 10) || 0),
    pre: resto.join('-')
  }
}

/** As tags do GitHub vêm com `v` na frente; o `app.getVersion()` não. */
export function normalizarVersao(versao: string): string {
  return versao.trim().replace(/^v/i, '')
}
