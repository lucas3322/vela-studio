/**
 * Seletor de store que constrói valor novo a cada chamada.
 *
 * ## O que aconteceu
 *
 * `useTabStore((s) => s.tabs.filter((t) => t.connectionId === id))` derrubou a
 * janela inteira. O Zustand compara o resultado do seletor com `Object.is`
 * para decidir se re-renderiza; `.filter()` devolve um array **novo** toda
 * vez, então a comparação nunca dá igual: renderiza, o seletor roda, array
 * novo, renderiza de novo. O laço não fecha e a tela fica em branco.
 *
 * Nada disso aparece no typecheck — os tipos estão corretos — nem num teste
 * de lógica pura, porque o defeito só existe durante a renderização. E não é
 * intermitente: com duas abas abertas, trava sempre.
 *
 * O jeito certo é o que o `Workspace.tsx` já fazia: selecionar a lista crua e
 * filtrar fora do seletor, num `useMemo`.
 *
 * Este teste lê o código-fonte e reprova a construção inline. É grosseiro de
 * propósito — prefere acusar demais a deixar passar, porque o preço de passar
 * é a janela em branco na mão do usuário.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = join('src', 'renderer', 'src')

function arquivosDoRenderer(pasta: string): string[] {
  const achados: string[] = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) achados.push(...arquivosDoRenderer(caminho))
    else if (/\.tsx?$/.test(entrada.name)) achados.push(caminho)
  }
  return achados
}

/**
 * Um seletor inline que devolve valor novo.
 *
 * Casa `use…Store((s) => …)` cujo corpo termina em `.filter(…)`, `.map(…)`,
 * `.slice(…)`, ou que abre `[` / `{` — todos criam referência nova. Chamadas
 * que devolvem escalar (`.find`, `.some`, `.length`) são seguras e ficam de
 * fora.
 */
const SELETOR_INSTAVEL =
  /use\w*Store\(\s*\((\w+)\)\s*=>\s*(?![^)]*\?\?)[^)]*?\.(filter|map|slice|concat|flatMap)\s*\(/g

test('nenhum seletor de store constrói array novo a cada chamada', () => {
  const culpados: string[] = []

  for (const arquivo of arquivosDoRenderer(RAIZ)) {
    const fonte = readFileSync(arquivo, 'utf-8')
    // Analisa por chamada, não por arquivo: um `.filter` numa linha distante
    // do seletor é uso legítimo.
    for (const achado of fonte.matchAll(SELETOR_INSTAVEL)) {
      const linha = fonte.slice(0, achado.index).split('\n').length
      culpados.push(`${arquivo}:${linha} → ${achado[0].replace(/\s+/g, ' ').slice(0, 72)}`)
    }
  }

  assert.deepEqual(
    culpados,
    [],
    'Seletor construindo valor novo a cada chamada — isto trava a janela em ' +
      'laço de renderização. Selecione o valor cru e filtre fora, num useMemo:\n  ' +
      culpados.join('\n  ')
  )
})

test('a varredura de fato encontra o padrão, quando ele existe', () => {
  // Âncora: sem isto, um erro na expressão faria o teste passar vigiando nada.
  const amostra = `
    const abas = useTabStore((s) => s.tabs.filter((t) => t.connectionId === id))
  `
  const achados = [...amostra.matchAll(SELETOR_INSTAVEL)]
  assert.equal(achados.length, 1, 'a expressão precisa reconhecer o caso real')
})

test('seletor que devolve escalar não é acusado', () => {
  // `find`, `some` e acesso a campo devolvem valor estável — são o uso normal
  // e não podem ser reprovados, senão o teste vira ruído e alguém o desliga.
  const amostras = [
    'const t = useTabStore((s) => s.tabs.find((x) => x.id === id))',
    'const n = useTabStore((s) => s.tabs.length)',
    'const v = useAppStore((s) => s.limiteAviso)',
    'const b = useTabStore((s) => s.tabs.some((x) => x.dirty))'
  ]
  for (const amostra of amostras) {
    assert.equal([...amostra.matchAll(SELETOR_INSTAVEL)].length, 0, amostra)
  }
})

test('o arquivo que causou o incidente está limpo', () => {
  const fonte = readFileSync(join(RAIZ, 'components', 'HelpPanel.tsx'), 'utf-8')
  assert.equal([...fonte.matchAll(SELETOR_INSTAVEL)].length, 0)
  assert.match(fonte, /useTabStore\(\(s\) => s\.tabs\)/, 'deve selecionar a lista crua')
})
