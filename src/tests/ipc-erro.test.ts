/**
 * O embrulho que o Electron põe em todo erro que atravessa o IPC.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { semEmbrulhoDoIpc } from '../shared/ipc-erro.ts'

test('tira o nome técnico do canal da frente da mensagem', () => {
  assert.equal(
    semEmbrulhoDoIpc(`Error invoking remote method 'connections:open': Error: O servidor SSH recusou o usuário "root".`),
    'O servidor SSH recusou o usuário "root".'
  )
})

test('também quando o erro original tinha outro tipo', () => {
  assert.equal(
    semEmbrulhoDoIpc("Error invoking remote method 'data:updateCell': TypeError: valor inválido"),
    'valor inválido'
  )
})

test('mensagem sem embrulho sai como entrou', () => {
  // Inclusive uma que por acaso começa com "Error:" — só o embrulho do IPC sai.
  assert.equal(semEmbrulhoDoIpc('Tabela não encontrada.'), 'Tabela não encontrada.')
  assert.equal(semEmbrulhoDoIpc('Error: algo'), 'Error: algo')
})
