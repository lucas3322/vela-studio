/**
 * Hook `afterPack` do electron-builder.
 *
 * O PROBLEMA
 * ----------
 * `better-sqlite3` é um módulo nativo. Ao empacotar para Windows a partir do
 * macOS, o electron-builder chama `@electron/rebuild`, que **não faz
 * compilação cruzada**: ele recompila para o *host*, e o `.node` que vai
 * dentro do .exe acaba sendo um Mach-O do macOS.
 *
 * O resultado é traiçoeiro: o instalador é gerado sem nenhum erro, o app abre
 * no Windows, MySQL/Postgres/Mongo funcionam (drivers em JS puro) — e só o
 * SQLite estoura, na primeira conexão, com um erro de módulo ilegível.
 *
 * A CORREÇÃO
 * ----------
 * Baixamos o binário pré-compilado oficial do better-sqlite3 para
 * win32-x64 no ABI do Electron em uso, e trocamos o arquivo dentro do
 * pacote já montado.
 *
 * Se o download falhar, este hook **interrompe o build**. Um instalador
 * silenciosamente quebrado é pior que build nenhum.
 */
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, copyFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') {
    // A conferência vem ANTES da assinatura: assinar um binário errado só
    // produziria um selo válido em cima de um pacote quebrado.
    await verificarModuloNativo(context)
    return assinarAdHoc(context)
  }
  if (context.electronPlatformName !== 'win32') return

  // Empacotando Windows **no** Windows (é o que o CI faz), o
  // `@electron/rebuild` já compilou o módulo nativo para a plataforma certa.
  // Trocar por um binário baixado seria desnecessário — e pior: uma falha de
  // rede derrubaria um build que estava correto.
  if (process.platform === 'win32') {
    console.log('  • build nativo do Windows: mantendo o better-sqlite3 compilado localmente')
    await verificarModuloNativo(context)
    return
  }

  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : 'x64'
  const version = require('better-sqlite3/package.json').version
  const electronVersion = context.packager.info.framework.version
  const abi = require('node-abi').getAbi(electronVersion, 'electron')

  const asset = `better-sqlite3-v${version}-electron-v${abi}-win32-${arch}.tar.gz`
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`

  const target = join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )

  try {
    await access(target)
  } catch {
    throw new Error(
      `afterPack: não encontrei o módulo nativo em ${target}.\n` +
        'Confira o `asarUnpack` do electron-builder.yml.'
    )
  }

  console.log(`  • trocando better-sqlite3 pelo binário win32-${arch} (Electron ABI ${abi})`)

  const work = await mkdtemp(join(tmpdir(), 'vela-bs3-'))
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(
        `não há binário pré-compilado para better-sqlite3 ${version} / Electron ABI ${abi} / win32-${arch}.\n` +
          `Tentei: ${url}\n` +
          'Gere o instalador do Windows em uma máquina Windows (ou no CI), onde a compilação é nativa.'
      )
    }

    const archive = join(work, asset)
    await pipeline(response.body, createWriteStream(archive))
    execFileSync('tar', ['xzf', archive, '-C', work])

    const extracted = join(work, 'build', 'Release', 'better_sqlite3.node')
    await access(extracted)
    await copyFile(extracted, target)

    console.log('  • better-sqlite3 substituído com sucesso')
    await verificarModuloNativo(context)
  } catch (error) {
    throw new Error(`afterPack: ${error.message}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Assina o app em ad-hoc quando não há certificado de desenvolvedor.
 *
 * POR QUE
 * -------
 * O macOS amarra cada item das Chaves ao **código assinado** que o criou. Sem
 * assinatura válida, ele não consegue confirmar que "Vela Studio" é o mesmo app
 * de antes — e pede a senha do usuário a cada abertura, com o aviso "a
 * autenticidade não pode ser verificada". Marcar "Permitir Sempre" não resolve:
 * não há identidade estável para registrar na lista de permissões.
 *
 * O electron-builder pula a assinatura quando não acha um "Developer ID", e o
 * bundle fica com a assinatura ad-hoc que o Electron traz de fábrica — que é
 * *inválida* depois que empacotamos nossos arquivos dentro dele
 * (`code has no resources but signature indicates they must be present`).
 *
 * Assinar em ad-hoc aqui dá ao app uma identidade válida e estável para aquele
 * binário. Efeito prático: "Permitir Sempre" passa a valer, e a senha só é
 * pedida de novo quando sai uma versão nova (binário novo = hash novo).
 *
 * LIMITE HONESTO
 * --------------
 * Ad-hoc não substitui o Developer ID: o Gatekeeper continua avisando na
 * primeira abertura e o app não pode ser notarizado. Para distribuir sem
 * atrito é preciso a conta paga da Apple.
 */
async function assinarAdHoc(context) {
  const temCertificado =
    process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_IDENTITY

  if (temCertificado) {
    console.log('  • certificado configurado; deixando a assinatura com o electron-builder')
    return
  }

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  try {
    await access(app)
  } catch {
    console.log(`  • afterPack: não achei o .app em ${app}; assinatura ad-hoc ignorada`)
    return
  }

  console.log('  • assinando em ad-hoc (sem Developer ID configurado)')

  const { execFileSync } = await import('node:child_process')
  try {
    // `--deep` é depreciado pela Apple para distribuição, mas é o caminho
    // prático para selar os binários aninhados do Electron em ad-hoc.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' })
    execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'pipe' })
    console.log('  • assinatura ad-hoc válida')
  } catch (error) {
    // Não derruba o build: sem assinatura o app ainda roda, só pede a senha
    // das Chaves com mais frequência.
    console.log(`  • aviso: assinatura ad-hoc falhou (${String(error.stderr || error.message).trim()})`)
  }
}

/**
 * Lê o cabeçalho de um binário e diz para qual plataforma/arquitetura ele é.
 *
 * Sem depender de `file` ou `lipo`, que não existem no runner do Windows.
 * Só precisamos dos primeiros bytes: cada formato se identifica ali.
 */
export function identificarBinario(bytes) {
  const u32 = (o, le) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o))

  // ELF: 0x7F 'E' 'L' 'F'
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return { plataforma: 'linux', arch: bytes[18] === 0xb7 ? 'arm64' : 'x64' }
  }

  // PE (Windows): 'MZ'
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return { plataforma: 'win32', arch: 'x64' }

  // Mach-O: pode ser little ou big endian, fino ou universal.
  const magic = u32(0, true)
  const gordo = magic === 0xbebafeca || magic === 0xbfbafeca // universal binary
  if (gordo) return { plataforma: 'darwin', arch: 'universal' }

  const machO = magic === 0xfeedfacf || magic === 0xfeedface || u32(0, false) === 0xfeedfacf
  if (machO) {
    const le = magic === 0xfeedfacf || magic === 0xfeedface
    const cpu = u32(4, le)
    // 0x0100000C = arm64, 0x01000007 = x86_64
    return { plataforma: 'darwin', arch: cpu === 0x0100000c ? 'arm64' : cpu === 0x01000007 ? 'x64' : `cpu:${cpu}` }
  }

  return { plataforma: 'desconhecida', arch: 'desconhecida' }
}

/**
 * Confere que o módulo nativo empacotado é da plataforma e arquitetura certas.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Três vezes um binário errado foi parar dentro do pacote sem que nada
 * reclamasse:
 *
 *  1. build multi-arch numa execução só — o hard link do `.node` fazia a
 *     recompilação para x64 sobrescrever o conteúdo dentro do bundle arm64
 *     que já estava empacotado e assinado;
 *  2. empacotar Windows a partir do macOS levava um Mach-O dentro do .exe;
 *  3. rodar `npm run linux` antes de `npm run mac` deixava um ELF do Linux
 *     no node_modules, e o build de macOS o empacotava.
 *
 * Em todos os casos o instalador saía "com sucesso". O usuário é quem
 * descobria — no macOS com "o app está danificado e não pode ser aberto",
 * porque o binário trocado também quebra o selo da assinatura.
 *
 * Um build que falha é muito melhor que um instalador quebrado.
 */
async function verificarModuloNativo(context) {
  const { readFile } = await import('node:fs/promises')

  const esperado = {
    plataforma: context.electronPlatformName,
    arch: context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : 'x64'
  }

  const base =
    esperado.plataforma === 'darwin'
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(context.appOutDir, 'resources')

  const alvo = join(
    base, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'
  )

  let cabecalho
  try {
    const conteudo = await readFile(alvo)
    cabecalho = conteudo.subarray(0, 32)
  } catch {
    throw new Error(
      `afterPack: não encontrei o módulo nativo em\n  ${alvo}\n` +
        'Confira o `asarUnpack` do electron-builder.yml.'
    )
  }

  const achado = identificarBinario(cabecalho)
  const ok =
    achado.plataforma === esperado.plataforma &&
    (achado.arch === esperado.arch || achado.arch === 'universal')

  if (!ok) {
    throw new Error(
      `afterPack: o better-sqlite3 empacotado é ${achado.plataforma}/${achado.arch}, ` +
        `mas este build é ${esperado.plataforma}/${esperado.arch}.\n\n` +
        '  O instalador sairia quebrado: no macOS o app abre como "danificado",\n' +
        '  porque o binário trocado também invalida o selo da assinatura.\n\n' +
        '  Costuma acontecer quando um build de outra plataforma deixou o\n' +
        '  node_modules em outro estado. Para resertar:\n\n' +
        '    npx electron-builder install-app-deps\n'
    )
  }

  console.log(`  • better-sqlite3 confere: ${achado.plataforma}/${achado.arch}`)
}
