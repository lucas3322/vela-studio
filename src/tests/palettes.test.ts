/**
 * Contraste de cada paleta de acento, nos dois temas.
 *
 * Existe porque a funcionalidade de trocar cor é justamente a que pode
 * desfazer o acerto de contraste do resto da interface. Uma paleta nova só
 * entra na lista se passar aqui.
 *
 * As fórmulas de claridade abaixo espelham `tokens.css`. Se aquele arquivo
 * mudar os valores, este teste passa a medir outra coisa — por isso os
 * números estão anotados junto.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PALETAS } from '../renderer/src/styles/palettes.ts'

type RGB = [number, number, number]

function hslParaRgb(h: number, s: number, l: number): RGB {
  const sn = s / 100
  const ln = l / 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): number =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function hexParaRgb(hex: string): RGB {
  const limpo = hex.replace('#', '')
  return [
    Number.parseInt(limpo.slice(0, 2), 16),
    Number.parseInt(limpo.slice(2, 4), 16),
    Number.parseInt(limpo.slice(4, 6), 16)
  ]
}

function luminancia(cor: RGB): number {
  const canais = cor.map((v) => {
    const n = v / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2]
}

function razao(a: RGB, b: RGB): number {
  const l1 = luminancia(a)
  const l2 = luminancia(b)
  const [alto, baixo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (alto + 0.05) / (baixo + 0.05)
}

/**
 * Fundos de cada tema, como em `tokens.css`.
 *
 * A claridade não está aqui de propósito: ela vem da própria paleta, porque
 * varia entre cores. Fixá-la neste teste faria ele medir uma combinação que o
 * app não produz — foi assim que a primeira versão deste arquivo reprovou
 * violeta e verde por um motivo que não existia no produto.
 */
const TEMAS = [
  {
    nome: 'escuro',
    fundo: hexParaRgb('#16181d'),
    lAccent: (p: (typeof PALETAS)[number]) => p.lEscuro,
    lTexto: (p: (typeof PALETAS)[number]) => p.lTextoEscuro,
    ink: 'inkEscuro'
  },
  {
    nome: 'claro',
    fundo: hexParaRgb('#ffffff'),
    lAccent: (p: (typeof PALETAS)[number]) => p.lClaro,
    lTexto: (p: (typeof PALETAS)[number]) => p.lTextoClaro,
    ink: 'inkClaro'
  }
] as const

const MIN_INTERFACE = 3.0
const MIN_TEXTO = 4.5

for (const paleta of PALETAS) {
  for (const tema of TEMAS) {
    const accent = hslParaRgb(paleta.h, paleta.s, tema.lAccent(paleta))
    const texto = hslParaRgb(paleta.h, paleta.s, tema.lTexto(paleta))
    const tinta = hexParaRgb(paleta[tema.ink])

    test(`${paleta.nome} · ${tema.nome}: acento visível sobre o fundo`, () => {
      const r = razao(accent, tema.fundo)
      assert.ok(r >= MIN_INTERFACE, `${r.toFixed(2)}:1, mínimo ${MIN_INTERFACE}`)
    })

    test(`${paleta.nome} · ${tema.nome}: texto de acento legível`, () => {
      const r = razao(texto, tema.fundo)
      assert.ok(r >= MIN_TEXTO, `${r.toFixed(2)}:1, mínimo ${MIN_TEXTO}`)
    })

    test(`${paleta.nome} · ${tema.nome}: tinta legível sobre o acento`, () => {
      // O botão primário é acento preenchido com esta tinta. Foi exatamente
      // aqui que o âmbar ficou meses a 2.87:1 no tema claro.
      const r = razao(tinta, accent)
      assert.ok(r >= MIN_TEXTO, `${r.toFixed(2)}:1, mínimo ${MIN_TEXTO}`)
    })
  }
}

test('a paleta padrão existe na lista', () => {
  assert.ok(PALETAS.some((p) => p.id === 'ambar'))
})

test('nenhum id de paleta repetido', () => {
  const ids = PALETAS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
})
