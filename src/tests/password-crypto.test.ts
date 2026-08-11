/**
 * Cifra local das senhas de conexão.
 *
 * Não depende de Electron, então roda direto. O que precisa estar travado:
 * o texto cifrado não pode conter a senha, adulteração precisa ser detectada,
 * e o formato antigo precisa ser reconhecido em vez de decifrado errado.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cifrarSenha,
  decifrarSenha,
  ehFormatoAntigo,
  esquecerChave
} from '../main/password-crypto.ts'

function comChaveNova<T>(acao: (caminho: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'vela-cripto-'))
  esquecerChave()
  try {
    return acao(join(dir, 'password.key'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    esquecerChave()
  }
}

test('cifra e decifra de volta', () => {
  comChaveNova((chave) => {
    const cifrado = cifrarSenha('senha123', chave)
    assert.equal(decifrarSenha(cifrado, chave), 'senha123')
  })
})

test('o texto cifrado não contém a senha', () => {
  // O ponto inteiro do recurso: quem abrir o connections.json não lê nada.
  comChaveNova((chave) => {
    const cifrado = cifrarSenha('senha123', chave)
    assert.ok(!cifrado.includes('senha123'))
    assert.ok(!Buffer.from(cifrado).toString('utf-8').includes('senha123'))
  })
})

test('duas cifragens da mesma senha são diferentes', () => {
  // IV aleatório por gravação. Sem isso, dois bancos com a mesma senha teriam
  // o mesmo texto cifrado, e o arquivo denunciaria a coincidência.
  comChaveNova((chave) => {
    assert.notEqual(cifrarSenha('igual', chave), cifrarSenha('igual', chave))
  })
})

test('a chave é de 256 bits e fica só na pasta do app', () => {
  comChaveNova((chave) => {
    cifrarSenha('x', chave)
    assert.ok(existsSync(chave))
    assert.equal(readFileSync(chave).length, 32, 'chave de 256 bits')
  })
})

test('no POSIX a chave nasce com permissão só do dono', { skip: process.platform === 'win32' }, () => {
  // `chmod` não existe no Windows: lá `mode & 0o777` volta 0o666 e a asserção
  // falharia sem que nada estivesse errado. Foi assim que este teste quebrou o
  // build do Windows enquanto passava no mac.
  //
  // A proteção no Windows vem da ACL do perfil do usuário, que o próprio
  // sistema aplica a %APPDATA% — não de nada que este código faça.
  comChaveNova((chave) => {
    cifrarSenha('x', chave)
    const modo = statSync(chave).mode & 0o777
    assert.equal(modo, 0o600, `esperado 0600, veio ${modo.toString(8)}`)
  })
})

test('conteúdo adulterado é recusado, não decifrado torto', () => {
  // O GCM autentica. Editar o JSON na mão precisa resultar em "não consigo
  // ler" e nova solicitação da senha, nunca em bytes corrompidos no driver.
  comChaveNova((chave) => {
    const cifrado = cifrarSenha('senha123', chave)
    const partes = cifrado.split('.')
    const dadosMexidos = Buffer.from(partes[3], 'base64url')
    dadosMexidos[0] ^= 0xff
    partes[3] = dadosMexidos.toString('base64url')

    assert.equal(decifrarSenha(partes.join('.'), chave), undefined)
  })
})

test('chave de outra instalação não decifra', () => {
  const cifrado = comChaveNova((chave) => cifrarSenha('senha123', chave))
  comChaveNova((outraChave) => {
    assert.equal(decifrarSenha(cifrado, outraChave), undefined)
  })
})

test('o formato antigo do Chaveiro é reconhecido, não decifrado', () => {
  // Base64 puro, como o safeStorage gravava. Tentar decifrar com a chave nova
  // devolveria lixo; o certo é dizer que não dá para ler e pedir de novo.
  const doSafeStorage = Buffer.from('qualquer coisa').toString('base64')
  assert.equal(ehFormatoAntigo(doSafeStorage), true)
  assert.equal(ehFormatoAntigo(undefined), false)

  comChaveNova((chave) => {
    assert.equal(ehFormatoAntigo(cifrarSenha('nova', chave)), false)
    assert.equal(decifrarSenha(doSafeStorage, chave), undefined)
  })
})

test('lixo qualquer não derruba a leitura', () => {
  comChaveNova((chave) => {
    for (const entrada of ['', 'v2.', 'v2.a.b', 'v2.!!!.???.###', 'não é base64']) {
      assert.equal(decifrarSenha(entrada, chave), undefined, `entrada: ${entrada}`)
    }
  })
})
