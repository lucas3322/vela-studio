/**
 * O texto de "para onde a conexão vai", na lista e na barra lateral.
 *
 * O bug: uma conexão por string de conexão aparecia com o host e a porta
 * padrão do formulário — `localhost:5432` para um banco em `db.interno:6543` —,
 * porque o texto ignorava a string. E o túnel SSH não aparecia em lugar nenhum.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { destinoDaConexao } from '../renderer/src/utils/destino.ts'

test('por host e porta', () => {
  assert.equal(destinoDaConexao({ driver: 'mysql', host: 'db.interno', port: 3307 }), 'db.interno:3307')
  assert.equal(
    destinoDaConexao({ driver: 'mysql', host: 'db.interno', port: 3307, database: 'vendas' }, { comBanco: true }),
    'db.interno:3307/vendas'
  )
})

test('por string: o endereço sai da string, não dos campos padrão do formulário', () => {
  const conexao = {
    driver: 'postgres' as const,
    host: 'localhost',
    port: 5432,
    connectionString: 'postgresql://app:segredo@db.interno:6543/vendas?sslmode=require'
  }
  assert.equal(destinoDaConexao(conexao), 'db.interno:6543')
  assert.equal(destinoDaConexao(conexao, { comBanco: true }), 'db.interno:6543/vendas')
})

test('a senha da string nunca aparece', () => {
  const texto = destinoDaConexao({ driver: 'mongodb', connectionString: 'mongodb://root:s3nh4@10.0.0.5:27017/app' })
  assert.ok(!texto.includes('s3nh4'), texto)
  assert.ok(!texto.includes('root'), texto)
})

test('o túnel SSH aparece, porque muda para onde a conexão vai', () => {
  assert.equal(
    destinoDaConexao({
      driver: 'postgres',
      connectionString: 'postgres://u:s@postgres:5432/lojinha',
      ssh: { enabled: true, host: 'bastion.empresa.com', user: 'deploy', auth: 'key' }
    }),
    'postgres:5432 · túnel bastion.empresa.com'
  )
})

test('túnel configurado mas desligado não aparece', () => {
  assert.equal(
    destinoDaConexao({ driver: 'mysql', host: 'db', port: 3306, ssh: { enabled: false, host: 'bastion', user: 'x', auth: 'password' } }),
    'db:3306'
  )
})

test('SQLite mostra o arquivo', () => {
  assert.equal(destinoDaConexao({ driver: 'sqlite', filePath: '/dados/app.db' }), '/dados/app.db')
})
