/**
 * Para onde o túnel SSH leva, e como a config do driver passa a apontar para ele.
 *
 * O que está em jogo é a string de conexão sair do outro lado **idêntica**,
 * exceto pelo endereço: uma senha com `@` ou `%` recodificada no caminho vira
 * "senha incorreta" no banco, e ninguém desconfia do túnel.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { configPeloTunel, destinoDoTunel } from '../main/ssh-destino.ts'
import type { ConnectionConfig } from '../shared/types.ts'

const base = (extra: Partial<ConnectionConfig>): ConnectionConfig => ({
  id: 'x',
  name: 'x',
  driver: 'mysql',
  ...extra
})

test('host e porta viram 127.0.0.1 e a porta local do túnel', () => {
  const config = base({ host: 'db.interno', port: 3307, user: 'app' })
  assert.deepEqual(destinoDoTunel(config), { host: 'db.interno', port: 3307 })
  const pelo = configPeloTunel(config, 51000)
  assert.equal(pelo.host, '127.0.0.1')
  assert.equal(pelo.port, 51000)
  assert.equal(pelo.user, 'app', 'o resto da config não muda')
})

test('sem host nem porta, o destino é localhost na porta padrão do banco', () => {
  // É o caso mais comum de túnel: o banco escuta só no localhost do servidor.
  assert.deepEqual(destinoDoTunel(base({ driver: 'postgres' })), { host: 'localhost', port: 5432 })
  assert.deepEqual(destinoDoTunel(base({ driver: 'redis' })), { host: 'localhost', port: 6379 })
})

test('string de conexão: só o endereço muda, credenciais saem byte a byte iguais', () => {
  const config = base({
    driver: 'postgres',
    connectionString: 'postgresql://app:p%40ss%25w@db.interno:6543/vendas?sslmode=require'
  })
  assert.deepEqual(destinoDoTunel(config), { host: 'db.interno', port: 6543 })
  assert.equal(
    configPeloTunel(config, 51000).connectionString,
    'postgresql://app:p%40ss%25w@127.0.0.1:51000/vendas?sslmode=require'
  )
})

test('Mongo pelo túnel ganha directConnection, senão tenta os membros pelo nome interno', () => {
  const config = base({ driver: 'mongodb', connectionString: 'mongodb://u:s@10.0.0.5:27017/app?authSource=admin' })
  assert.equal(
    configPeloTunel(config, 51000).connectionString,
    'mongodb://u:s@127.0.0.1:51000/app?authSource=admin&directConnection=true'
  )
  assert.equal(
    configPeloTunel(base({ driver: 'mongodb', connectionString: 'mongodb://10.0.0.5' }), 51000).connectionString,
    'mongodb://127.0.0.1:51000/?directConnection=true'
  )
})

test('Mongo que já pediu directConnection não ganha o parâmetro duas vezes', () => {
  const uri = 'mongodb://10.0.0.5:27017/?directConnection=false'
  assert.equal(
    configPeloTunel(base({ driver: 'mongodb', connectionString: uri }), 51000).connectionString,
    'mongodb://127.0.0.1:51000/?directConnection=false'
  )
})

test('Mongo por host e porta vira string com directConnection e a senha codificada', () => {
  const pelo = configPeloTunel(
    base({ driver: 'mongodb', host: '10.0.0.5', user: 'app', password: 'a@b' }),
    51000
  )
  assert.equal(pelo.connectionString, 'mongodb://app:a%40b@127.0.0.1:51000/?directConnection=true')
})

test('mongodb+srv é recusado com o motivo, em vez de falhar depois sem explicação', () => {
  assert.throws(
    () => destinoDoTunel(base({ driver: 'mongodb', connectionString: 'mongodb+srv://u:s@cluster0.abc.mongodb.net' })),
    /mongodb\+srv:\/\/ não funciona por túnel/
  )
})

test('replica set com vários hosts é recusado: o túnel leva a um só', () => {
  assert.throws(
    () => destinoDoTunel(base({ driver: 'mongodb', connectionString: 'mongodb://a:27017,b:27017/app' })),
    /2 servidores/
  )
})

test('IPv6 entre colchetes', () => {
  assert.deepEqual(
    destinoDoTunel(base({ driver: 'postgres', connectionString: 'postgres://u@[::1]:5433/db' })),
    { host: '::1', port: 5433 }
  )
})

test('Redis por string', () => {
  const config = base({ driver: 'redis', connectionString: 'redis://:segredo@cache.interno:6380/2' })
  assert.deepEqual(destinoDoTunel(config), { host: 'cache.interno', port: 6380 })
  assert.equal(configPeloTunel(config, 51000).connectionString, 'redis://:segredo@127.0.0.1:51000/2')
})
