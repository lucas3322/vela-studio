/**
 * Detecção de UPDATE/DELETE sem WHERE.
 *
 * É o gatilho da confirmação que impede alterar a tabela inteira por engano.
 * Falso negativo aqui significa comando destrutivo passando direto; falso
 * positivo significa um diálogo no caminho de quem só queria rodar um SELECT,
 * e o aviso que aparece à toa é o aviso que se aprende a ignorar.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUnboundedMutation, splitStatements } from '../shared/sql-shape.ts'

const semWhere = (sql: string): string[] => splitStatements(sql).filter(isUnboundedMutation)

test('pega UPDATE e DELETE sem WHERE', () => {
  assert.equal(isUnboundedMutation('UPDATE accounts SET customer_id_allgar = 16201'), true)
  assert.equal(isUnboundedMutation('DELETE FROM logs'), true)
  assert.equal(isUnboundedMutation('delete from logs'), true, 'caixa não importa')
})

test('não incomoda quem escreveu WHERE', () => {
  assert.equal(isUnboundedMutation('UPDATE accounts SET x = 1 WHERE id = 5'), false)
  assert.equal(isUnboundedMutation('DELETE FROM logs WHERE criado_em < NOW()'), false)
})

test('SELECT nunca dispara o aviso', () => {
  // Um diálogo que aparece em consulta comum é um diálogo que se aprende a
  // fechar sem ler — e aí ele não protege mais nada.
  for (const sql of [
    'SELECT * FROM accounts',
    'SELECT * FROM accounts WHERE id = 1',
    'INSERT INTO logs (msg) VALUES (1)',
    'CREATE TABLE t (id INT)'
  ]) {
    assert.equal(isUnboundedMutation(sql), false, sql)
  }
})

test('comentário não esconde a falta do WHERE', () => {
  // `-- WHERE id = 1` comentado não vale como condição.
  assert.equal(isUnboundedMutation('UPDATE t SET a = 1 -- WHERE id = 1'), true)
  assert.equal(isUnboundedMutation('UPDATE t SET a = 1 /* WHERE id = 1 */'), true)
})

test('num lote, só os comandos sem WHERE são apontados', () => {
  const lote = `
    SELECT * FROM accounts;
    UPDATE accounts SET ativo = 0;
    DELETE FROM logs WHERE id = 1;
    DELETE FROM sessoes;
  `
  const achados = semWhere(lote)
  assert.equal(achados.length, 2)
  assert.match(achados[0], /UPDATE accounts/)
  assert.match(achados[1], /DELETE FROM sessoes/)
})

test('lote inteiramente seguro não pede confirmação', () => {
  const lote = 'SELECT 1; UPDATE t SET a = 1 WHERE id = 2; SELECT 2;'
  assert.deepEqual(semWhere(lote), [])
})

test('espaço e quebra de linha antes do comando não enganam', () => {
  assert.equal(isUnboundedMutation('\n\n   UPDATE t SET a = 1'), true)
})
