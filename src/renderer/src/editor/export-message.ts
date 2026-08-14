/**
 * A frase que a IDE diz depois de exportar.
 *
 * Parece detalhe e não é: a versão anterior dizia "Salvo em…" em verde depois
 * de gravar 100 linhas de uma tabela de 250.000. A mensagem era a única coisa
 * entre a pessoa e uma conclusão errada — e ela mentia por omissão.
 *
 * As regras aqui: sempre dizer **quantas** linhas, sempre dizer **quantos**
 * arquivos, e quando dividir, dizer **por quê**. Ninguém deveria precisar
 * abrir o arquivo para descobrir que existe um segundo.
 */

const numero = new Intl.NumberFormat('pt-BR')

/** Só o nome do arquivo, sem o caminho — o caminho inteiro não cabe no toast. */
function nomeDe(caminho: string): string {
  return caminho.split(/[/\\]/).pop() ?? caminho
}

export function descreverExportacao({
  arquivos,
  linhas
}: {
  arquivos: string[]
  linhas: number
}): string {
  if (arquivos.length === 0) return 'Nada foi gravado.'

  if (linhas === 0) {
    // Arquivo só com cabeçalho. Dizer "0 linhas salvas" soaria como falha;
    // o que aconteceu é que a consulta rodou e não achou nada.
    return `A consulta não devolveu nenhuma linha. Salvei o cabeçalho em ${nomeDe(arquivos[0])}.`
  }

  const contagem = `${numero.format(linhas)} ${linhas === 1 ? 'linha' : 'linhas'}`

  if (arquivos.length === 1) {
    return `${contagem} em ${arquivos[0]}`
  }

  return (
    `${contagem} em ${arquivos.length} arquivos, de ${nomeDe(arquivos[0])} a ` +
    `${nomeDe(arquivos[arquivos.length - 1])} — divididos porque uma planilha ` +
    `abre no máximo 1.048.576 linhas por arquivo.`
  )
}
