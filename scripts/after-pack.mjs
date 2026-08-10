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
  if (context.electronPlatformName === 'darwin') return assinarAdHoc(context)
  if (context.electronPlatformName !== 'win32') return

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
