/**
 * Gera os ícones da aplicação a partir de `build/icon.svg`.
 *
 * Saídas:
 *   build/icon.png    1024×1024, fonte para tudo e fallback do electron-builder
 *   build/icon.icns   macOS (via iconutil, nativo do sistema)
 *   build/icon.ico    Windows (container montado aqui; ver comentário abaixo)
 *
 * Rasterização por `qlmanage`, o gerador de miniaturas do próprio macOS —
 * evita depender de librsvg ou ImageMagick, que não vêm instalados.
 *
 * Uso: npm run icons
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const svgPath = join(buildDir, 'icon.svg')

if (!existsSync(svgPath)) {
  console.error('build/icon.svg não encontrado.')
  process.exit(1)
}

if (process.platform !== 'darwin') {
  console.error('Este script depende de qlmanage/sips/iconutil e só roda no macOS.')
  console.error('Em outro sistema, gere build/icon.png (1024×1024) e deixe o electron-builder converter.')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'vela-icons-'))

try {
  // ── 1. SVG → PNG 1024 ───────────────────────────────────────────────
  execFileSync('qlmanage', ['-t', '-s', '1024', '-o', work, svgPath], { stdio: 'ignore' })
  const rasterized = join(work, 'icon.svg.png')
  if (!existsSync(rasterized)) throw new Error('qlmanage não gerou a miniatura do SVG')

  const master = join(buildDir, 'icon.png')
  execFileSync('cp', [rasterized, master])
  console.log('build/icon.png       1024×1024')

  /** Reamostra o mestre para um tamanho, devolvendo o caminho gerado. */
  const resize = (size, outPath) => {
    execFileSync('sips', ['-z', String(size), String(size), master, '--out', outPath], {
      stdio: 'ignore'
    })
    return outPath
  }

  // ── 2. .icns ────────────────────────────────────────────────────────
  // O iconutil exige um .iconset com nomes exatos; @2x são as versões Retina.
  const iconset = join(work, 'icon.iconset')
  mkdirSync(iconset)
  const icnsVariants = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png']
  ]
  for (const [size, name] of icnsVariants) resize(size, join(iconset, name))

  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')], {
    stdio: 'inherit'
  })
  console.log('build/icon.icns      10 variantes, 16→1024')

  // ── 3. .ico ─────────────────────────────────────────────────────────
  // Montado à mão porque o macOS não tem ferramenta que escreva ICO.
  // O formato é simples: um cabeçalho, uma entrada de diretório por tamanho,
  // e os dados. Desde o Vista cada entrada pode ser um PNG inteiro, o que
  // dispensa converter para bitmap com máscara.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const images = icoSizes.map((size) => ({
    size,
    data: readFileSync(resize(size, join(work, `ico-${size}.png`)))
  }))

  const HEADER = 6
  const ENTRY = 16
  const header = Buffer.alloc(HEADER)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // 1 = ícone
  header.writeUInt16LE(images.length, 4)

  let offset = HEADER + ENTRY * images.length
  const entries = images.map((image) => {
    const entry = Buffer.alloc(ENTRY)
    // 256 é gravado como 0: o campo tem um byte só.
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0)
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1)
    entry.writeUInt8(0, 2) // paleta: nenhuma
    entry.writeUInt8(0, 3) // reservado
    entry.writeUInt16LE(1, 4) // planos
    entry.writeUInt16LE(32, 6) // bits por pixel
    entry.writeUInt32LE(image.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.data.length
    return entry
  })

  writeFileSync(
    join(buildDir, 'icon.ico'),
    Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
  )
  console.log(`build/icon.ico       ${icoSizes.join(', ')}`)
  console.log('\nÍcones gerados.')
} finally {
  rmSync(work, { recursive: true, force: true })
}
