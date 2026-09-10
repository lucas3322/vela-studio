/**
 * Versionamento e release do Vela Studio.
 *
 * O que faz, em uma passada:
 *   1. lê os commits desde a última tag
 *   2. decide se o salto é major, minor ou patch
 *   3. escreve a nova versão no package.json
 *   4. gera a seção do CHANGELOG.md
 *   5. commita e cria a tag anotada `vX.Y.Z`
 *   6. dá push (a tag dispara o workflow que gera os instaladores)
 *
 * COMO ELE DECIDE O SALTO
 * -----------------------
 * Se os commits seguem Conventional Commits, a decisão é automática:
 *   `feat!:` ou `BREAKING CHANGE:` no corpo → major
 *   `feat:`                                 → minor
 *   qualquer outra coisa                    → patch
 *
 * Se não seguem — que é o caso de commits em português corrido —, ele avisa
 * e usa patch. Nesse caso diga o salto na mão: `npm run release minor`.
 * O argumento explícito sempre vence a análise.
 *
 * Uso:
 *   npm run release                # decide sozinho
 *   npm run release minor          # força o salto
 *   npm run release -- --dry-run   # mostra o que faria, sem escrever nada
 *   npm run release -- --no-push   # commita e taggeia, mas não envia
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classificarCommit, decidirSalto, explicarSalto } from './release-semver.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = join(root, 'package.json')
const changelogPath = join(root, 'CHANGELOG.md')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const noPush = args.includes('--no-push')
const allowDirty = args.includes('--allow-dirty')
const forced = args.find((a) => ['major', 'minor', 'patch'].includes(a))

/**
 * `stdio` com stderr em pipe: sem isso, um `git describe` sem tags nenhuma
 * despeja "fatal: No names found" no terminal mesmo quando o erro é esperado
 * e já está tratado.
 */
const git = (...params) =>
  execFileSync('git', params, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

// ── Guardas ───────────────────────────────────────────────────────────
try {
  git('rev-parse', '--is-inside-work-tree')
} catch {
  fail('Isto não é um repositório git.')
}

const dirty = git('status', '--porcelain')
if (dirty && !allowDirty && !dryRun) {
  fail(
    'Há alterações não commitadas. Commite antes de gerar a release,\n' +
      '  senão a tag aponta para um estado que não existe no histórico.\n' +
      '  (use --allow-dirty se souber o que está fazendo)'
  )
}

// ── Commits desde a última tag ────────────────────────────────────────
let lastTag = null
try {
  lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*')
} catch {
  // Primeira release: consideramos todo o histórico.
}

const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'

/**
 * `%x1f` e `%x1e` fazem o **git** emitir os separadores de unidade e de
 * registro. Escrever os bytes direto na string de formato não funciona: o
 * `execFileSync` do Node recusa argumentos com byte nulo, e um separador
 * visível (`|||`) poderia aparecer dentro de uma mensagem de commit.
 *
 * O separador de registro é obrigatório porque o corpo do commit tem quebras
 * de linha — dividir por `\n` embaralharia qualquer commit multi-linha.
 */
const raw = git('log', range, '--pretty=format:%s%x1f%b%x1f%h%x1e', '--no-merges')

const commits = raw
  .split('\x1e')
  .map((record) => record.trim())
  .filter(Boolean)
  .map((record) => {
    const [subject, body, hash] = record.split('\x1f')
    return { subject: subject ?? '', body: body ?? '', hash: hash ?? '' }
  })

if (commits.length === 0) {
  fail(`Nenhum commit novo desde ${lastTag ?? 'o início'}. Nada a versionar.`)
}

// ── Classificação ─────────────────────────────────────────────────────
const classified = commits.map((c) => ({ ...c, ...classificarCommit(c) }))
const conventionalCount = classified.filter((c) => c.type).length

const bump = decidirSalto(classified, forced)
const motivoDoSalto = explicarSalto(classified, forced)

// ── Nova versão ───────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

const next =
  bump === 'major'
    ? `${major + 1}.0.0`
    : bump === 'minor'
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`

// ── Relatório ─────────────────────────────────────────────────────────
console.log(`\n  ${pkg.version} → ${next}   (${bump}${forced ? ', forçado' : ''})`)
// O motivo na tela: o acidente que motivou isto foi o script mostrar
// "breaking" ao lado do commit e anunciar "(patch)" duas linhas acima.
console.log(`  motivo: ${motivoDoSalto}`)
console.log(`  ${commits.length} commit(s) desde ${lastTag ?? 'o início do projeto'}\n`)

if (!forced && conventionalCount === 0) {
  console.log('  ⚠ Nenhum commit segue Conventional Commits, então usei patch.')
  console.log('    Para automatizar de verdade, prefixe os commits com `feat:` / `fix:`.')
  console.log('    Ou diga o salto agora: npm run release minor\n')
}

for (const commit of classified) {
  const tag = commit.breaking ? '!' : commit.type ? commit.type : '·'
  console.log(`    ${tag.padEnd(6)} ${commit.description}  ${commit.hash}`)
}

// ── CHANGELOG ─────────────────────────────────────────────────────────
const GROUPS = [
  { key: 'breaking', title: 'Mudanças incompatíveis', test: (c) => c.breaking },
  { key: 'feat', title: 'Novidades', test: (c) => c.type === 'feat' && !c.breaking },
  { key: 'fix', title: 'Correções', test: (c) => c.type === 'fix' && !c.breaking },
  { key: 'perf', title: 'Desempenho', test: (c) => c.type === 'perf' && !c.breaking },
  {
    key: 'other',
    title: 'Outras mudanças',
    test: (c) => !c.breaking && !['feat', 'fix', 'perf'].includes(c.type)
  }
]

function buildSection() {
  const date = new Date().toISOString().slice(0, 10)
  const lines = [`## ${next} — ${date}`, '']

  for (const group of GROUPS) {
    const items = classified.filter(group.test)
    if (items.length === 0) continue
    lines.push(`### ${group.title}`, '')
    for (const item of items) lines.push(`- ${item.description} (${item.hash})`)
    lines.push('')
  }
  return lines.join('\n')
}

const section = buildSection()

const HEADER = `# Changelog

Todas as mudanças relevantes do Vela Studio.
Gerado por \`npm run release\` a partir dos commits.
`

const previous = existsSync(changelogPath)
  ? readFileSync(changelogPath, 'utf-8').replace(HEADER, '').trimStart()
  : ''

const changelog = `${HEADER}\n${section}\n${previous}`.trimEnd() + '\n'

// ── Aplicar ───────────────────────────────────────────────────────────
if (dryRun) {
  console.log('\n  — dry run, nada foi escrito —\n')
  console.log(section)
  process.exit(0)
}

pkg.version = next
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)
writeFileSync(changelogPath, changelog)

git('add', 'package.json', 'CHANGELOG.md')
git('commit', '-m', `release: v${next}`)
git('tag', '-a', `v${next}`, '-m', `v${next}`)

console.log(`\n  ✓ commit e tag v${next} criados`)

if (noPush) {
  console.log(`\n  Para publicar:  git push --follow-tags\n`)
  process.exit(0)
}

try {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  git('push', 'origin', branch, '--follow-tags')
  console.log('  ✓ enviado — o workflow de build começa pela tag\n')
} catch {
  // Sem remoto configurado não é erro: o trabalho local já está feito.
  console.log('\n  ⚠ Não consegui dar push (sem remoto?).')
  console.log('    O commit e a tag estão criados localmente.')
  console.log('    Quando tiver remoto:  git push --follow-tags\n')
}
