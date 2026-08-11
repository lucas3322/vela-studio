/**
 * Regras de persistência da conexão que não dependem do Electron.
 *
 * O `ConnectionStore` importa `safeStorage`, então aqui espelhamos a lógica
 * de fronteira: o que pode e o que não pode atravessar o IPC, e o que é
 * derivado e portanto nunca deve ser gravado.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

interface Registro {
  id: string
  name: string
  encryptedPassword?: string
  hasPassword?: boolean
}

/** Espelha `ConnectionStore.paraUI`. */
function paraUI({ encryptedPassword, ...rest }: Registro): Registro {
  return { ...rest, hasPassword: !!encryptedPassword }
}

/** Espelha o descarte do campo derivado em `ConnectionStore.save`. */
function limparDerivado(config: Registro & { password?: string }): Registro {
  const { password: _p, hasPassword: _h, ...rest } = config
  return rest
}

test('o texto cifrado nunca atravessa para a UI', () => {
  // Valia para o list() e não valia para o retorno do save(), que devolvia o
  // registro cru. A UI não tem o que fazer com o cifrado, e mandá-lo para o
  // processo que renderiza dado de terceiros é risco de graça.
  const saida = paraUI({ id: 'c1', name: 'CRM', encryptedPassword: 'BASE64==' })
  assert.equal('encryptedPassword' in saida, false)
  assert.equal(saida.hasPassword, true)
})

test('sem senha guardada, hasPassword é false', () => {
  assert.equal(paraUI({ id: 'c1', name: 'CRM' }).hasPassword, false)
})

test('hasPassword é derivado e não pode ser gravado', () => {
  // A UI devolve o objeto que recebeu do list(), com hasPassword dentro.
  // Persistir esse valor faz o disco divergir do que existe de fato: foi
  // exatamente o que apareceu no connections.json real, com hasPassword:false
  // gravado ao lado de nenhuma senha.
  const vindoDaUI = { id: 'c1', name: 'CRM', hasPassword: true, password: 'segredo' }
  const gravado = limparDerivado(vindoDaUI)

  assert.equal('hasPassword' in gravado, false, 'campo derivado não vai para o disco')
  assert.equal('password' in gravado, false, 'senha em texto nunca vai para o disco')
})

test('o valor obsoleto da UI não sobrevive ao round-trip', () => {
  // Sequência real: salva com senha → UI lista → usuário edita e salva de novo.
  const noDisco: Registro = { id: 'c1', name: 'CRM', encryptedPassword: 'BASE64==' }
  const naUI = paraUI(noDisco)
  assert.equal(naUI.hasPassword, true)

  // A UI devolve o objeto; o disco recebe só o que é dele.
  const regravado = { ...limparDerivado({ ...naUI, password: '' }), encryptedPassword: 'BASE64==' }
  assert.equal(paraUI(regravado).hasPassword, true, 'a senha precisa sobreviver à edição')
  assert.equal(
    Object.keys(regravado).includes('hasPassword'),
    false,
    'e o campo derivado não pode ter voltado para o disco'
  )
})
