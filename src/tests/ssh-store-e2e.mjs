/**
 * Os segredos do túnel SSH no `ConnectionStore` real — cifra, disco e o que
 * atravessa para a UI.
 *
 * O store roda de verdade (empacotado com um Electron de mentira que só dá a
 * pasta de dados). Um espelho da lógica passaria mesmo com o store quebrado —
 * e aqui a falha é grave e silenciosa: uma senha SSH em texto num JSON.
 */
import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let ConnectionStore
let pasta

before(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'vela-store-'))
  process.env.VELA_TESTE_USERDATA = pasta
  ;({ ConnectionStore } = await import('./.ssh-store-bundle.mjs'))
})

const conexao = (ssh) => ({
  id: 'c1', name: 'Produção', driver: 'mysql', host: 'localhost', port: 3306, user: 'app',
  password: 'senha-do-banco',
  ssh: { enabled: true, host: 'bastion.empresa.com', port: 22, user: 'deploy', auth: 'password', ...ssh }
})

const noDisco = () => JSON.parse(readFileSync(join(pasta, 'connections.json'), 'utf8'))

test('a senha SSH vai cifrada para o disco, nunca em texto', () => {
  const store = new ConnectionStore()
  store.save(conexao({ password: 'senha-ssh-secreta', passphrase: 'frase-secreta' }))

  const bruto = readFileSync(join(pasta, 'connections.json'), 'utf8')
  assert.ok(!bruto.includes('senha-ssh-secreta'), 'a senha SSH em texto não pode estar no arquivo')
  assert.ok(!bruto.includes('frase-secreta'), 'a senha da chave em texto não pode estar no arquivo')
  const [registro] = noDisco()
  assert.ok(registro.ssh.encryptedPassword, 'o cifrado está lá')
  assert.ok(registro.ssh.encryptedPassphrase)
})

test('para a UI vai só o sinal de que existe senha — nem o texto, nem o cifrado', () => {
  const store = new ConnectionStore()
  const [paraUI] = store.list()
  assert.equal(paraUI.ssh.hasPassword, true)
  assert.equal(paraUI.ssh.hasPassphrase, true)
  assert.equal('encryptedPassword' in paraUI.ssh, false)
  assert.equal('password' in paraUI.ssh, false)
})

test('o main recupera a senha SSH para abrir o túnel', () => {
  const store = new ConnectionStore()
  const completa = store.resolve('c1')
  assert.equal(completa.ssh.password, 'senha-ssh-secreta')
  assert.equal(completa.ssh.passphrase, 'frase-secreta')
})

test('salvar com o campo vazio mantém a senha guardada', () => {
  // O formulário nunca recebe a senha de volta: vazio é "não mexa".
  const store = new ConnectionStore()
  store.save(conexao({ password: '', passphrase: '' }))
  assert.equal(store.resolve('c1').ssh.password, 'senha-ssh-secreta')
})

test('desmarcar "Salvar senha" apaga também os segredos do túnel', () => {
  const store = new ConnectionStore()
  store.save(conexao({ password: 'x' }), false)
  const [registro] = noDisco()
  assert.equal(registro.ssh.encryptedPassword, undefined)
  assert.equal(registro.ssh.encryptedPassphrase, undefined)
})

test('a chave do servidor é guardada uma vez e nunca sobrescrita', () => {
  const store = new ConnectionStore()
  store.guardarChaveSsh('c1', 'SHA256:primeira')
  store.guardarChaveSsh('c1', 'SHA256:outra')
  assert.equal(store.chaveSshGuardada('c1').impressao, 'SHA256:primeira')
})

test('editar a conexão sem trocar de servidor mantém a chave guardada', () => {
  const store = new ConnectionStore()
  // A UI devolve o que recebeu do list(), com a impressão digital junto.
  store.save({ ...conexao({ hostKeyFingerprint: 'SHA256:primeira' }), name: 'Produção (renomeada)' })
  assert.equal(store.chaveSshGuardada('c1').impressao, 'SHA256:primeira')
})

test('trocar o servidor SSH esquece a chave do anterior', () => {
  // Mantê-la faria o servidor novo ser recusado como se fosse um impostor.
  const store = new ConnectionStore()
  store.save(conexao({ host: 'bastion-novo.empresa.com', hostKeyFingerprint: 'SHA256:primeira' }))
  assert.equal(store.chaveSshGuardada('c1').impressao, undefined)
})

test('esquecer a chave pelo botão', () => {
  const store = new ConnectionStore()
  store.guardarChaveSsh('c1', 'SHA256:qualquer')
  store.esquecerChaveSsh('c1')
  assert.equal(store.chaveSshGuardada('c1').impressao, undefined)
})
