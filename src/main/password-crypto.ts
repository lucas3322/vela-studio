import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Cifra as senhas de conexão com uma chave guardada no próprio disco.
 *
 * ## O que isto protege, e o que não protege
 *
 * Protege contra leitura casual: abrir o `connections.json`, mandar o arquivo
 * para alguém, subir a pasta num backup sem pensar. A senha não está legível
 * ali.
 *
 * **Não protege** contra quem tem acesso aos arquivos da conta: a chave mora
 * ao lado do dado cifrado, então quem lê os dois decifra. Isso é uma escolha
 * consciente do projeto — o caminho com garantia real é o Chaveiro do macOS,
 * que foi trocado por este por causa do pedido de autorização repetido que ele
 * provoca em apps sem certificado de desenvolvedor.
 *
 * A interface diz isso ao usuário com todas as letras. Cifra que promete mais
 * do que entrega é pior que texto puro, porque convida a confiar.
 *
 * ## Formato
 *
 * `v2.<iv>.<tag>.<dados>`, tudo em base64url. O prefixo existe para distinguir
 * do formato antigo (safeStorage, base64 puro): sem ele, tentaríamos decifrar
 * com a chave errada e devolveríamos lixo em vez de um "não consigo ler".
 */

const PREFIXO = 'v2'
const ALGORITMO = 'aes-256-gcm'
const TAMANHO_IV = 12

let chaveEmMemoria: Buffer | undefined

/**
 * Devolve a chave, criando-a na primeira vez.
 *
 * O arquivo nasce com permissão 0600 — leitura e escrita só do dono. Não
 * impede quem já está na conta, mas evita que outro usuário da mesma máquina
 * leia, que é o cenário realista num Mac compartilhado.
 */
function obterChave(caminhoDaChave: string): Buffer {
  if (chaveEmMemoria) return chaveEmMemoria

  if (existsSync(caminhoDaChave)) {
    const bruto = readFileSync(caminhoDaChave)
    if (bruto.length === 32) {
      chaveEmMemoria = bruto
      return chaveEmMemoria
    }
    // Arquivo corrompido ou truncado: gerar outra é melhor que falhar para
    // sempre. As senhas antigas ficam ilegíveis e são pedidas de novo.
  }

  const nova = randomBytes(32)
  mkdirSync(dirname(caminhoDaChave), { recursive: true })
  writeFileSync(caminhoDaChave, nova, { mode: 0o600 })
  try {
    chmodSync(caminhoDaChave, 0o600)
  } catch {
    // Sistemas de arquivo sem permissão POSIX (rede, alguns volumes externos).
    // Não é motivo para deixar de funcionar.
  }
  chaveEmMemoria = nova
  return nova
}

export function cifrarSenha(senha: string, caminhoDaChave: string): string {
  const iv = randomBytes(TAMANHO_IV)
  const cipher = createCipheriv(ALGORITMO, obterChave(caminhoDaChave), iv)
  const dados = Buffer.concat([cipher.update(senha, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [PREFIXO, iv.toString('base64url'), tag.toString('base64url'), dados.toString('base64url')].join(
    '.'
  )
}

/**
 * Decifra. Devolve `undefined` para qualquer coisa que não seja nossa —
 * formato antigo, chave trocada, conteúdo adulterado.
 *
 * O GCM valida a autenticidade: um `connections.json` editado à mão faz o
 * `final()` lançar, e preferimos pedir a senha de novo a entregar bytes
 * corrompidos ao driver.
 */
export function decifrarSenha(guardado: string, caminhoDaChave: string): string | undefined {
  const partes = guardado.split('.')
  if (partes.length !== 4 || partes[0] !== PREFIXO) return undefined

  try {
    const decipher = createDecipheriv(
      ALGORITMO,
      obterChave(caminhoDaChave),
      Buffer.from(partes[1], 'base64url')
    )
    decipher.setAuthTag(Buffer.from(partes[2], 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(partes[3], 'base64url')),
      decipher.final()
    ]).toString('utf-8')
  } catch {
    return undefined
  }
}

/** Só para os testes: esquece a chave carregada. */
export function esquecerChave(): void {
  chaveEmMemoria = undefined
}

/** Reconhece o formato antigo, do safeStorage, para a UI poder explicar. */
export function ehFormatoAntigo(guardado?: string): boolean {
  return !!guardado && !guardado.startsWith(`${PREFIXO}.`)
}
