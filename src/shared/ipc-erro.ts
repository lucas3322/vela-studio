/**
 * A mensagem de um erro vindo do main, sem o embrulho que o Electron põe.
 *
 * Todo erro lançado num `ipcMain.handle` chega no renderer como
 * `Error invoking remote method 'connections:open': Error: <mensagem>`. O main
 * já traduzia a mensagem para português com cuidado — e o Electron colava o
 * nome técnico do canal na frente, sempre. Era o que aparecia no aviso para
 * quem tentava conectar num banco fora do ar, editar uma célula recusada ou
 * abrir um túnel SSH com a senha errada.
 */
export function semEmbrulhoDoIpc(mensagem: string): string {
  return mensagem.replace(/^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/, '')
}
