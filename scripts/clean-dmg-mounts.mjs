/**
 * Desmonta volumes DMG deixados para trás por um build anterior.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Para montar um .dmg, o electron-builder monta um volume em
 * `/Volumes/<título>` e depois chama `hdiutil detach`. Se alguma coisa estiver
 * segurando o volume — uma janela do Finder aberta nele, o Spotlight indexando,
 * ou um build anterior interrompido —, o detach falha:
 *
 *     ⨯ unable to execute hdiutil args=["detach","--quiet","/Volumes/Vela Studio"]
 *       error=Exit code: 16
 *
 * O electron-builder tenta 5 vezes e desiste. Como ele não limpa a sobra, a
 * próxima execução falha de novo, sempre — o build fica quebrado até alguém
 * desmontar na mão.
 *
 * Rodamos isto antes de todo build de macOS. É idempotente e silencioso
 * quando não há nada montado.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const PRODUCT = 'Vela Studio'

/** Nomes que o macOS dá quando já existe um volume igual: "Vela Studio 1". */
const matches = (name) => name === PRODUCT || name.startsWith(`${PRODUCT} `)

function detach(volume, force = false) {
  const args = ['detach', volume, '-quiet']
  if (force) args.push('-force')
  execFileSync('hdiutil', args, { stdio: 'ignore' })
}

if (process.platform !== 'darwin') process.exit(0)

let volumes = []
try {
  volumes = readdirSync('/Volumes').filter(matches)
} catch {
  process.exit(0)
}

if (volumes.length === 0) process.exit(0)

for (const name of volumes) {
  const path = `/Volumes/${name}`
  try {
    detach(path)
    console.log(`  • volume solto: ${path}`)
  } catch {
    // Segunda tentativa com -force: é o que resolve quando o Finder ou o
    // Spotlight ainda seguram o volume.
    try {
      detach(path, true)
      console.log(`  • volume solto à força: ${path}`)
    } catch {
      console.error(
        `\n✗ Não consegui desmontar ${path}.\n` +
          '  Feche qualquer janela do Finder aberta nesse volume e rode de novo.\n' +
          `  Se insistir:  hdiutil detach "${path}" -force\n`
      )
      process.exit(1)
    }
  }
}
