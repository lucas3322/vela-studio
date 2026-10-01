import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import ssh2, { type ConnectConfig } from 'ssh2'
import type { SshTunnelConfig } from '../shared/types.ts'
import { ErroDoTunel, type Destino } from './ssh-destino.ts'

/*
  Import padrão, não `import { Client } from 'ssh2'`. O `ssh2` é CommonJS, e o
  main do app roda como ESM: o Node nem sempre descobre as exportações nomeadas
  de um módulo CommonJS. O typecheck aceita a forma nomeada e o app estouraria
  só em execução, ao abrir o primeiro túnel.
*/
const { Client } = ssh2

/**
 * Túnel SSH: uma porta local que leva, por dentro do servidor SSH, até o banco.
 *
 * O driver conecta em `127.0.0.1:<porta>` como se o banco estivesse aqui. Cada
 * conexão que ele abre nessa porta vira um canal `direct-tcpip` no servidor
 * SSH, que abre a conexão de verdade com o banco do lado de lá.
 *
 * Sem dependência do Electron: é Node puro, e o teste de ponta a ponta usa
 * este mesmo arquivo contra um servidor SSH real.
 */

export interface TunelSsh {
  /** Porta local para onde o driver deve apontar. */
  porta: number
  /** Impressão digital da chave do servidor SSH, no formato do OpenSSH. */
  impressaoDigital: string
  /** Por que o túnel caiu depois de aberto, se caiu. */
  motivoDaQueda(): string | undefined
  fechar(): Promise<void>
}

/**
 * Impressão digital no mesmo formato do `ssh-keygen -lf` e do aviso do `ssh`:
 * `SHA256:` + base64 sem o preenchimento. É o que permite conferir com quem
 * administra o servidor, que vê exatamente este texto do lado de lá.
 */
export function impressaoDigital(chave: Buffer): string {
  return `SHA256:${createHash('sha256').update(chave).digest('base64').replace(/=+$/, '')}`
}

function expandirHome(caminho: string): string {
  return caminho.startsWith('~') ? `${homedir()}${caminho.slice(1)}` : caminho
}

function credenciais(ssh: SshTunnelConfig): Partial<ConnectConfig> {
  switch (ssh.auth) {
    case 'password':
      if (!ssh.password) throw new ErroDoTunel('Informe a senha do usuário SSH.')
      return { password: ssh.password }

    case 'key': {
      if (!ssh.privateKeyPath?.trim()) throw new ErroDoTunel('Escolha o arquivo da chave privada SSH.')
      const caminho = expandirHome(ssh.privateKeyPath.trim())
      try {
        return { privateKey: readFileSync(caminho), passphrase: ssh.passphrase || undefined }
      } catch (erro) {
        const codigo = (erro as NodeJS.ErrnoException).code
        throw new ErroDoTunel(
          codigo === 'ENOENT'
            ? `Não existe arquivo de chave em ${caminho}.`
            : `Não consegui ler a chave privada em ${caminho} (${codigo ?? (erro as Error).message}).`
        )
      }
    }

    case 'agent': {
      const agente = process.env.SSH_AUTH_SOCK
      if (!agente) {
        throw new ErroDoTunel(
          'Não achei o agente SSH: a variável SSH_AUTH_SOCK está vazia para a IDE. ' +
            'Use senha ou arquivo de chave, ou abra a IDE pelo terminal onde o agente está ativo.'
        )
      }
      return { agent: agente }
    }
  }
}

/** O erro do SSH antes do túnel abrir, dito do jeito que ajuda a resolver. */
function traduzir(
  erro: Error & { code?: string; level?: string },
  ssh: SshTunnelConfig,
  divergencia?: { guardada: string; recebida: string }
): string {
  const onde = `${ssh.host}:${ssh.port || 22}`
  const texto = erro.message ?? ''

  if (divergencia) {
    return (
      `A chave do servidor SSH ${onde} mudou desde a última conexão ` +
      `(guardada ${divergencia.guardada}, recebida ${divergencia.recebida}). ` +
      'Pode ser uma reinstalação do servidor — ou alguém no meio do caminho. Confirme com quem ' +
      'administra o servidor antes de seguir; se foi reinstalação, esqueça a chave guardada em Editar conexão.'
    )
  }
  if (/no passphrase given/i.test(texto)) {
    return 'A chave privada é protegida por senha: informe a senha da chave.'
  }
  if (/bad passphrase|integrity check failed/i.test(texto)) {
    return 'A senha da chave privada está errada.'
  }
  if (/cannot parse privatekey|unsupported key format/i.test(texto)) {
    return `Não consegui ler a chave privada: formato não suportado (${texto}).`
  }
  if (erro.level === 'client-authentication' || /authentication methods failed/i.test(texto)) {
    const com = ssh.auth === 'password' ? 'essa senha' : ssh.auth === 'key' ? 'essa chave' : 'as chaves do agente'
    return `O servidor SSH ${onde} recusou o usuário "${ssh.user}" com ${com}.`
  }
  switch (erro.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Não achei o servidor SSH "${ssh.host}": o nome não resolve.`
    case 'ECONNREFUSED':
      return `O servidor SSH ${onde} recusou a conexão. A porta está certa? O SSH costuma ser a 22.`
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Sem rota de rede até o servidor SSH ${onde}. Precisa de VPN?`
    case 'ETIMEDOUT':
      return `O servidor SSH ${onde} não respondeu a tempo.`
  }
  if (/timed out while waiting for handshake/i.test(texto)) {
    return `O servidor SSH ${onde} não respondeu a tempo.`
  }
  return `Falha no túnel SSH até ${onde}: ${texto}`
}

export function abrirTunel(
  ssh: SshTunnelConfig,
  destino: Destino,
  opcoes: { timeoutMs?: number } = {}
): Promise<TunelSsh> {
  return new Promise((resolve, reject) => {
    const cliente = new Client()
    const sockets = new Set<Socket>()
    let servidor: Server | undefined
    let chaveRecebida: string | undefined
    let divergencia: { guardada: string; recebida: string } | undefined
    let aberto = false
    let queda: string | undefined

    const fechar = (): Promise<void> =>
      new Promise((ok) => {
        for (const socket of sockets) socket.destroy()
        cliente.end()
        if (servidor?.listening) servidor.close(() => ok())
        else ok()
      })

    const falhar = (mensagem: string): void => {
      void fechar()
      reject(new ErroDoTunel(mensagem))
    }

    cliente.on('ready', () => {
      /*
        Sonda antes de entregar a porta: o servidor SSH consegue chegar no
        banco? É o erro mais comum de quem configura túnel — pôr no host do
        banco o endereço de fora, quando o que vale é o de dentro do servidor.
        Sem a sonda, o túnel abria "com sucesso" e o driver falhava depois com
        um ECONNRESET que não diz nada sobre a causa.
      */
      cliente.forwardOut('127.0.0.1', 0, destino.host, destino.port, (erro, canal) => {
        if (erro) {
          falhar(
            `O túnel SSH abriu, mas o servidor SSH não consegue chegar no banco em ` +
              `${destino.host}:${destino.port} (${erro.message}). O host e a porta do banco ` +
              'são os vistos de dentro do servidor SSH — quase sempre localhost.'
          )
          return
        }
        canal.close()

        servidor = createServer((socket) => {
          sockets.add(socket)
          socket.on('close', () => sockets.delete(socket))
          cliente.forwardOut(
            socket.remoteAddress ?? '127.0.0.1',
            socket.remotePort ?? 0,
            destino.host,
            destino.port,
            (erroDoCanal, fluxo) => {
              if (erroDoCanal) {
                socket.destroy()
                return
              }
              socket.pipe(fluxo).pipe(socket)
              fluxo.on('error', () => socket.destroy())
              socket.on('error', () => fluxo.destroy())
            }
          )
        })
        servidor.on('error', (erroLocal) => {
          if (!aberto) falhar(`Não consegui abrir a porta local do túnel: ${erroLocal.message}`)
        })
        // Só no 127.0.0.1: a porta do túnel não pode ficar exposta na rede
        // local, senão qualquer um no Wi-Fi chegaria ao banco pelo seu Mac.
        servidor.listen(0, '127.0.0.1', () => {
          aberto = true
          resolve({
            porta: (servidor!.address() as AddressInfo).port,
            impressaoDigital: chaveRecebida!,
            motivoDaQueda: () => queda,
            fechar
          })
        })
      })
    })

    cliente.on('error', (erro) => {
      if (aberto) {
        queda = `O túnel SSH caiu: ${erro.message}`
        return
      }
      falhar(traduzir(erro, ssh, divergencia))
    })
    cliente.on('close', () => {
      if (aberto && !queda) queda = 'O túnel SSH foi fechado pelo servidor.'
    })

    let autenticacao: Partial<ConnectConfig>
    try {
      autenticacao = credenciais(ssh)
    } catch (erro) {
      reject(erro)
      return
    }

    try {
      cliente.connect({
        host: ssh.host,
        port: ssh.port || 22,
        username: ssh.user,
        readyTimeout: opcoes.timeoutMs ?? 15_000,
        // Sem keepalive, um NAT ou firewall no caminho derruba o túnel parado
        // em poucos minutos, e a próxima consulta falha sem motivo aparente.
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (chave: Buffer) => {
          chaveRecebida = impressaoDigital(chave)
          if (ssh.hostKeyFingerprint && ssh.hostKeyFingerprint !== chaveRecebida) {
            divergencia = { guardada: ssh.hostKeyFingerprint, recebida: chaveRecebida }
            return false
          }
          return true
        },
        ...autenticacao
      })
    } catch (erro) {
      // Chave em formato que o ssh2 não entende estoura aqui, antes de qualquer rede.
      falhar(traduzir(erro as Error, ssh))
    }
  })
}
