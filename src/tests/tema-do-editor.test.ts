/**
 * Contraste dos balões do editor — a lista de autocomplete e o balão de ajuda.
 *
 * O bug que originou isto: no tema claro, a sugestão **em foco** era a única
 * ilegível da lista. O tema do Monaco é declarado com `inherit: true`, e a cor
 * que ninguém escreveu vem do tema base do VS Code por uma corrente de
 * heranças que termina em branco puro:
 *
 *     editorSuggestWidget.selectedForeground
 *       → quickInputList.focusForeground
 *         → list.activeSelectionForeground = branco
 *
 * Lá o fundo da seleção é azul forte; aqui é uma faixa clara. Branco sobre
 * quase-branco — e no tema escuro o mesmo branco caía sobre `#343b46` e nada
 * denunciava o problema.
 *
 * Estes testes medem as duas coisas que a tela pediu: dá para LER o texto da
 * linha em foco, e dá para VER qual linha está em foco. Nas duas, para todas
 * as paletas — porque o mesmo número de claridade em matizes diferentes não
 * produz a mesma luminância.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coresDoBalao } from '../renderer/src/editor/tema-do-editor.ts'
import { PALETAS } from '../renderer/src/styles/palettes.ts'

type RGB = [number, number, number]

function canais(hex: string): RGB {
  const limpo = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(limpo.slice(i, i + 2), 16)) as RGB
}

function luminancia(cor: RGB): number {
  const partes = cor.map((v) => {
    const n = v / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * partes[0] + 0.7152 * partes[1] + 0.0722 * partes[2]
}

function razao(a: string, b: string): number {
  const l1 = luminancia(canais(a))
  const l2 = luminancia(canais(b))
  const [alto, baixo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (alto + 0.05) / (baixo + 0.05)
}

const MIN_TEXTO = 4.5
/**
 * Mínimo para a faixa de seleção se separar do fundo do balão.
 *
 * Não é o 3:1 de elemento de interface: a faixa não carrega informação
 * sozinha, ela só diz "é esta linha" enquanto o texto em cima continua
 * legível. O parâmetro é o `--grid-line`, que a 1.38:1 é percebido como malha
 * de tabela — abaixo de ~1.2 a faixa lê como fundo.
 */
const MIN_FAIXA = 1.2

for (const tema of ['claro', 'escuro'] as const) {
  for (const paleta of PALETAS) {
    const cores = coresDoBalao(tema, paleta.id)

    test(`${tema} · ${paleta.nome}: texto da lista legível`, () => {
      const r = razao(cores.texto, cores.fundo)
      assert.ok(r >= MIN_TEXTO, `${r.toFixed(2)}:1, mínimo ${MIN_TEXTO}`)
    })

    test(`${tema} · ${paleta.nome}: texto da linha EM FOCO legível`, () => {
      // Este é o teste do bug. Antes, aqui havia branco sobre a faixa clara.
      const r = razao(cores.selecaoTexto, cores.selecaoFundo)
      assert.ok(r >= MIN_TEXTO, `${r.toFixed(2)}:1, mínimo ${MIN_TEXTO}`)
    })

    test(`${tema} · ${paleta.nome}: a faixa de foco se separa do fundo`, () => {
      // O outro lado da pinça: resolver o contraste do texto clareando a faixa
      // até ela virar o próprio fundo apagaria "qual linha o Enter aceita".
      const r = razao(cores.selecaoFundo, cores.fundo)
      assert.ok(r >= MIN_FAIXA, `${r.toFixed(2)}:1, mínimo ${MIN_FAIXA}`)
    })

    test(`${tema} · ${paleta.nome}: o trecho que casou é legível nas duas linhas`, () => {
      const naLista = razao(cores.realce, cores.fundo)
      const emFoco = razao(cores.realceSelecionado, cores.selecaoFundo)
      assert.ok(naLista >= MIN_TEXTO, `na lista: ${naLista.toFixed(2)}:1`)
      assert.ok(emFoco >= MIN_TEXTO, `em foco: ${emFoco.toFixed(2)}:1`)
    })
  }
}

/**
 * Guarda de cobertura: toda cor de balão declarada no tema do Monaco tem que
 * sair daqui.
 *
 * O bug foi uma cor **não declarada**. Se alguém voltar a escrever um hex
 * solto dentro do `defineThemes`, ele não passa por medição nenhuma — e a
 * próxima herança silenciosa entra pela mesma porta.
 */
test('o tema do Monaco não tem cor de balão escrita à mão', async () => {
  const { readFileSync } = await import('node:fs')
  const fonte = readFileSync(
    new URL('../renderer/src/editor/monaco-setup.ts', import.meta.url),
    'utf8'
  )

  const linhasDeBalao = fonte
    .split('\n')
    .filter((linha) => /'(editorSuggestWidget|editorHoverWidget|editorWidget)\./.test(linha))

  assert.ok(linhasDeBalao.length > 0, 'nenhuma cor de balão encontrada — o teste ficou cego')

  for (const linha of linhasDeBalao) {
    assert.ok(
      /balao(Claro|Escuro)\./.test(linha),
      `cor de balão com valor solto, fora da medição: ${linha.trim()}`
    )
  }
})
