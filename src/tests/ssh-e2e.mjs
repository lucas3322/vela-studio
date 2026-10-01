/**
 * Túnel SSH de ponta a ponta, contra um servidor SSH real e os quatro bancos.
 *
 * O servidor SSH (`vela-ssh-test`) fica na mesma rede interna do compose que
 * os bancos, e de lá os enxerga pelo nome do serviço — `mysql:3306`,
 * `postgres:5432` — como um bastion enxerga o banco de produção. Daqui, esses
 * nomes não existem: se a consulta chega, foi pelo túnel.
 *
 * Usa o `ConnectionManager` de verdade, o mesmo caminho do app.
 *
 * Subir: docker compose -f src/tests/docker-compose.yml up -d --wait
 * Rodar: npm run test:ssh
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect as conectarTcp } from 'node:net'
import ssh2 from 'ssh2'
import { ConnectionManager } from './.ssh-bundle.mjs'
import { abrirTunel, impressaoDigital } from './.ssh-tunel-bundle.mjs'

const { Client, utils } = ssh2

const SSH = { enabled: true, host: '127.0.0.1', port: 22221, user: 'root' }
const COM_SENHA = { ...SSH, auth: 'password', password: 'vela123' }

let pasta
let chaveSimples
let chaveProtegida
let chaveDoServidor

/** Roda um comando no servidor SSH com login por senha — só para preparar o teste. */
function noServidor(comando) {
  return new Promise((resolve, reject) => {
    const cliente = new Client()
    cliente
      .on('ready', () => {
        cliente.exec(comando, (erro, fluxo) => {
          if (erro) return reject(erro)
          let saida = ''
          fluxo.on('data', (d) => (saida += d)).on('close', () => {
            cliente.end()
            resolve(saida)
          })
        })
      })
      .on('error', reject)
      .connect({ host: SSH.host, port: SSH.port, username: 'root', password: 'vela123' })
  })
}

before(async () => {
  pasta = mkdtempSync(join(tmpdir(), 'vela-ssh-'))
  const simples = utils.generateKeyPairSync('ed25519')
  const protegida = utils.generateKeyPairSync('ed25519', { passphrase: 'frase-da-chave', cipher: 'aes256-ctr' })
  chaveSimples = join(pasta, 'id_simples')
  chaveProtegida = join(pasta, 'id_protegida')
  writeFileSync(chaveSimples, simples.private, { mode: 0o600 })
  writeFileSync(chaveProtegida, protegida.private, { mode: 0o600 })
  await noServidor(
    // `>>`, não `>`: sobrescrever apagaria chaves que outra pessoa (ou outro
    // teste) autorizou no mesmo servidor, e a próxima conexão dela falharia
    // com "recusou a chave" sem nada a ver com o que ela fez.
    `printf '%s\\n%s\\n' '${simples.public}' '${protegida.public}' >> /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys`
  )

  // A chave do servidor, lida por outro caminho que não o túnel — para
  // conferir que o túnel reporta a mesma impressão digital.
  await new Promise((resolve, reject) => {
    const cliente = new Client()
    cliente
      .on('ready', () => {
        cliente.end()
        resolve()
      })
      .on('error', reject)
      .connect({
        host: SSH.host,
        port: SSH.port,
        username: 'root',
        password: 'vela123',
        hostVerifier: (chave) => {
          chaveDoServidor = impressaoDigital(chave)
          return true
        }
      })
  })
})

const manager = new ConnectionManager()
after(() => manager.closeAll())

// ── os quatro bancos ─────────────────────────────────────────────────────

test('MySQL pelo túnel, com senha SSH', async () => {
  const { impressaoDigitalSsh } = await manager.open({
    id: 'my', name: 'my', driver: 'mysql',
    host: 'mysql', port: 3306, user: 'root', password: 'vela123', database: 'lojinha',
    ssh: COM_SENHA
  })
  const [r] = await manager.get('my').driver.query('SELECT 1 + 1 AS dois', { queryId: 'a' })
  assert.equal(r.rows[0][0], 2)
  assert.equal(impressaoDigitalSsh, chaveDoServidor, 'o túnel reporta a chave real do servidor')
  assert.match(impressaoDigitalSsh, /^SHA256:[A-Za-z0-9+/]{43}$/)
  await manager.close('my')
})

test('PostgreSQL pelo túnel, com chave privada e string de conexão', async () => {
  await manager.open({
    id: 'pg', name: 'pg', driver: 'postgres',
    connectionString: 'postgres://postgres:vela123@postgres:5432/lojinha',
    ssh: { ...SSH, auth: 'key', privateKeyPath: chaveSimples }
  })
  const [r] = await manager.get('pg').driver.query('SELECT current_database()', { queryId: 'b' })
  assert.equal(r.rows[0][0], 'lojinha')
  await manager.close('pg')
})

test('MongoDB pelo túnel, com chave protegida por senha', async () => {
  // Por host e porta: o túnel monta a string com directConnection sozinho.
  await manager.open({
    id: 'mg', name: 'mg', driver: 'mongodb', host: 'mongo', port: 27017, database: 'lojinha',
    ssh: { ...SSH, auth: 'key', privateKeyPath: chaveProtegida, passphrase: 'frase-da-chave' }
  })
  const [r] = await manager.get('mg').driver.query('db.getCollectionNames()', { queryId: 'c' })
  const nomes = r.rows.map((linha) => linha[r.columns.findIndex((c) => c.name === 'name')])
  assert.ok(nomes.length > 0, 'listou as coleções do outro lado do túnel')
  await manager.close('mg')
})

test('Redis pelo túnel', async () => {
  await manager.open({
    id: 'rd', name: 'rd', driver: 'redis', host: 'redis', port: 6379,
    ssh: COM_SENHA
  })
  const [r] = await manager.get('rd').driver.query('PING', { queryId: 'd' })
  assert.equal(r.rows[0][0], 'PONG')
  await manager.close('rd')
})

test('Testar pelo túnel mostra a chave do servidor, para ser conferida', async () => {
  const r = await manager.test({
    id: 't', name: 't', driver: 'mysql', host: 'mysql', port: 3306,
    user: 'root', password: 'vela123', ssh: COM_SENHA
  })
  assert.equal(r.ok, true, r.message)
  assert.ok(r.message.includes(`Chave do servidor: ${chaveDoServidor}`), r.message)
})

// ── as falhas, cada uma dizendo a causa ──────────────────────────────────

const falha = async (config) => {
  const r = await manager.test({ id: 'f', name: 'f', driver: 'mysql', host: 'mysql', port: 3306, user: 'root', password: 'vela123', ...config })
  assert.equal(r.ok, false)
  assert.equal(r.falhaNoTunel, true, 'marcado para não passar pelo tradutor de erro de banco')
  return r.message
}

test('senha SSH errada', async () => {
  assert.match(await falha({ ssh: { ...COM_SENHA, password: 'errada' } }), /recusou o usuário "root" com essa senha/)
})

test('chave protegida sem a senha da chave', async () => {
  assert.match(
    await falha({ ssh: { ...SSH, auth: 'key', privateKeyPath: chaveProtegida } }),
    /protegida por senha: informe a senha da chave/
  )
})

test('arquivo de chave que não existe', async () => {
  assert.match(
    await falha({ ssh: { ...SSH, auth: 'key', privateKeyPath: join(pasta, 'nao-existe') } }),
    /Não existe arquivo de chave/
  )
})

test('servidor SSH fora do ar', async () => {
  assert.match(await falha({ ssh: { ...COM_SENHA, port: 22229 } }), /recusou a conexão/)
})

test('o SSH abre, mas não chega no banco: o erro diz onde procurar', async () => {
  // O erro mais comum de túnel: o banco não escuta onde a config diz, visto de
  // dentro do servidor SSH. Sem a sonda, isto virava um ECONNRESET do driver.
  const mensagem = await falha({ host: 'mysql', port: 3399, ssh: COM_SENHA })
  assert.match(mensagem, /não consegue chegar no banco em mysql:3399/)
  assert.match(mensagem, /vistos de dentro do servidor SSH/)
})

test('chave do servidor diferente da guardada: recusa', async () => {
  const mensagem = await falha({
    ssh: { ...COM_SENHA, hostKeyFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
  })
  assert.match(mensagem, /mudou desde a última conexão/)
  assert.ok(mensagem.includes(chaveDoServidor), 'mostra a chave recebida, para conferir')
})

test('chave do servidor igual à guardada: conecta', async () => {
  const r = await manager.test({
    id: 'k', name: 'k', driver: 'mysql', host: 'mysql', port: 3306, user: 'root', password: 'vela123',
    ssh: { ...COM_SENHA, hostKeyFingerprint: chaveDoServidor }
  })
  assert.equal(r.ok, true, r.message)
})

// ── ciclo de vida ────────────────────────────────────────────────────────

test('a porta local só escuta no 127.0.0.1, e some ao fechar', async () => {
  const tunel = await abrirTunel(COM_SENHA, { host: 'mysql', port: 3306 })
  const alcanca = (host) =>
    new Promise((resolve) => {
      const s = conectarTcp({ host, port: tunel.porta }, () => {
        s.destroy()
        resolve(true)
      }).on('error', () => resolve(false))
    })
  assert.equal(await alcanca('127.0.0.1'), true)
  await tunel.fechar()
  assert.equal(await alcanca('127.0.0.1'), false, 'túnel fechado não deixa porta para trás')
})

test('senha errada do banco não deixa túnel aberto para trás', async () => {
  // O processo de cada sessão SSH no servidor se chama "sshd: root". A contagem
  // inclui a própria sessão que faz a pergunta — igual antes e depois.
  const sessoes = async () => (await noServidor("ps -o args | grep -c '^sshd: root' || true")).trim()
  const antes = await sessoes()
  assert.ok(Number(antes) >= 1, 'a contagem enxerga as sessões — senão o teste passaria à toa')
  await assert.rejects(
    manager.open({
      id: 'x', name: 'x', driver: 'mysql', host: 'mysql', port: 3306,
      user: 'root', password: 'errada', ssh: COM_SENHA
    })
  )
  await new Promise((r) => setTimeout(r, 500))
  const depois = await sessoes()
  assert.equal(depois, antes, 'as sessões SSH abertas voltam ao que eram')
})

test('túnel que cai no meio: a causa fica registrada para a próxima consulta', async () => {
  await manager.open({
    id: 'q', name: 'q', driver: 'mysql', host: 'mysql', port: 3306,
    user: 'root', password: 'vela123', ssh: COM_SENHA
  })
  assert.equal(manager.motivoDaQuedaDoTunel('q'), undefined)
  // Derruba, do lado do servidor, as sessões SSH abertas — inclusive a do túnel.
  await noServidor("pkill -f '^sshd: root' || true").catch(() => undefined)
  await new Promise((r) => setTimeout(r, 1500))
  assert.match(manager.motivoDaQuedaDoTunel('q') ?? '', /túnel SSH/)
  await manager.close('q')
})
