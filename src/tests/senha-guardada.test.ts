/**
 * Resolução da senha ao testar e ao conectar.
 *
 * O formulário de edição abre com o campo de senha vazio de propósito: a senha
 * cifrada nunca viaja para o renderer. Então "campo vazio" quer dizer "não
 * digitei", **não** "a senha é vazia".
 *
 * A versão anterior só tratava `undefined`, e o modal manda string vazia.
 * Editar uma conexão e clicar em Testar ou Conectar ia ao banco sem credencial
 * e voltava "Nenhuma senha foi enviada para o banco. Esta conexão foi salva sem
 * senha" — falso, porque a senha estava salva. E conectar pela lista
 * funcionava, o que fazia o defeito parecer inexplicável.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

interface Config {
  id: string
  password?: string
  host?: string
  port?: number
}

/** Espelha `comSenhaGuardada` do `ipc-handlers.ts`. */
function comSenhaGuardada(
  config: Config,
  guardadas: Record<string, Config | undefined>
): Config {
  if (config.password) return config
  const guardada = guardadas[config.id]
  if (!guardada?.password) return config
  return { ...config, password: guardada.password }
}

const NO_DISCO = { c1: { id: 'c1', password: 'segredo' } }

// ── o bug relatado ───────────────────────────────────────────────────

test('campo de senha vazio usa a senha guardada', () => {
  // É o caso exato: modal de edição aberto, campo em branco, clicou em Testar.
  const r = comSenhaGuardada({ id: 'c1', password: '' }, NO_DISCO)
  assert.equal(r.password, 'segredo')
})

test('senha ausente também usa a guardada', () => {
  // Este caso já funcionava antes; o teste existe para não regredir.
  const r = comSenhaGuardada({ id: 'c1' }, NO_DISCO)
  assert.equal(r.password, 'segredo')
})

// ── o que não pode mudar ─────────────────────────────────────────────

test('senha digitada vence a guardada', () => {
  // Trocar a senha no formulário precisa valer, senão não haveria como
  // corrigir uma senha que mudou no banco.
  const r = comSenhaGuardada({ id: 'c1', password: 'nova' }, NO_DISCO)
  assert.equal(r.password, 'nova')
})

test('edições do formulário sobrevivem à resolução', () => {
  // Só a senha vem do disco. Puxar a conexão guardada inteira descartaria a
  // troca de host ou de porta que a pessoa acabou de fazer — e ela testaria
  // o servidor antigo achando que testou o novo.
  const r = comSenhaGuardada(
    { id: 'c1', password: '', host: '10.0.0.9', port: 3307 },
    { c1: { id: 'c1', password: 'segredo', host: '127.0.0.1', port: 3306 } }
  )
  assert.equal(r.host, '10.0.0.9')
  assert.equal(r.port, 3307)
  assert.equal(r.password, 'segredo')
})

test('conexão sem senha no disco continua sem senha', () => {
  // Banco que realmente não pede senha. Inventar uma faria o erro do driver
  // ficar mais confuso, não menos.
  const r = comSenhaGuardada({ id: 'novo', password: '' }, NO_DISCO)
  assert.equal(r.password, '')
})

test('conexão que nunca foi salva não quebra', () => {
  const r = comSenhaGuardada({ id: 'inexistente', password: '' }, NO_DISCO)
  assert.equal(r.password, '')
  assert.equal(r.id, 'inexistente')
})
