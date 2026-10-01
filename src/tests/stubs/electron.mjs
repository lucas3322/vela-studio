/**
 * Electron de mentira, só o que o `ConnectionStore` usa: a pasta de dados.
 *
 * Existe para o teste exercitar o store **de verdade** — a cifra, a gravação
 * em disco, o que sai para a UI — em vez de uma cópia da lógica, que passaria
 * mesmo com o store quebrado.
 */
export const app = {
  getPath: () => process.env.VELA_TESTE_USERDATA
}
