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
