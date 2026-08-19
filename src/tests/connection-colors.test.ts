/**
 * Cores de identificação de conexão.
 *
 * A cor existe para separar "BANCO DE PRODUÇÃO" de "BANCO CRM LOCAL" num
 * relance. Se ela não for visível, o recurso não falha com erro — ele
 * simplesmente não ajuda, e a pessoa segue distinguindo os bancos pela palavra
 * no meio do nome. Por isso o contraste é medido aqui, não conferido a olho.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CORES_DE_CONEXAO,
  corDaConexao,
  proximaCorLivre
} from '../renderer/src/styles/connection-colors.ts'

// ── WCAG ─────────────────────────────────────────────────────────────

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2]
}

function razao(a: string, b: string): number {
  const [alto, baixo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (alto + 0.05) / (baixo + 0.05)
}

/** A superfície mais difícil de cada tema — onde a marca precisa aparecer. */
const PIOR_CASO = { escuro: '#262b33', claro: '#f6f7f9' } as const

/** Marca de identidade é elemento de interface: 3:1, não 4.5:1. */
const MINIMO = 3

// ── contraste ────────────────────────────────────────────────────────

test('toda cor é visível sobre a pior superfície de cada tema', () => {
  for (const cor of CORES_DE_CONEXAO) {
    const escuro = razao(cor.escuro, PIOR_CASO.escuro)
    const claro = razao(cor.claro, PIOR_CASO.claro)
    assert.ok(escuro >= MINIMO, `${cor.id} no escuro: ${escuro.toFixed(2)}:1`)
    assert.ok(claro >= MINIMO, `${cor.id} no claro: ${claro.toFixed(2)}:1`)
  }
})

test('também aparecem sobre o fundo principal, que é onde os cartões ficam', () => {
  for (const cor of CORES_DE_CONEXAO) {
    assert.ok(razao(cor.escuro, '#16181d') >= MINIMO, `${cor.id} sobre bg-app escuro`)
    assert.ok(razao(cor.claro, '#ffffff') >= MINIMO, `${cor.id} sobre bg-app claro`)
  }
})

// ── distinguibilidade ────────────────────────────────────────────────

test('nenhum par de cores é quase igual', () => {
  // Duas cores parecidas são pior do que uma cor só: a pessoa acredita estar
  // distinguindo e não está.
  for (const tema of ['escuro', 'claro'] as const) {
    for (let i = 0; i < CORES_DE_CONEXAO.length; i++) {
      for (let j = i + 1; j < CORES_DE_CONEXAO.length; j++) {
        const a = CORES_DE_CONEXAO[i]
        const b = CORES_DE_CONEXAO[j]
        const distancia = Math.sqrt(
          [1, 3, 5]
            .map((k) => parseInt(a[tema].slice(k, k + 2), 16) - parseInt(b[tema].slice(k, k + 2), 16))
            .reduce((soma, d) => soma + d * d, 0)
        )
        assert.ok(distancia > 60, `${a.id} e ${b.id} quase iguais no ${tema}: ${distancia.toFixed(0)}`)
      }
    }
  }
})

test('id e nome são únicos, e todo nome é legível no seletor', () => {
  assert.equal(new Set(CORES_DE_CONEXAO.map((c) => c.id)).size, CORES_DE_CONEXAO.length)
  assert.equal(new Set(CORES_DE_CONEXAO.map((c) => c.nome)).size, CORES_DE_CONEXAO.length)
  for (const cor of CORES_DE_CONEXAO) {
    // O nome escrito é o que salva quem não distingue os matizes.
    assert.ok(cor.nome.length >= 4, cor.id)
  }
})

test('nenhuma cor é âmbar — colidiria com o acento da própria IDE', () => {
  for (const cor of CORES_DE_CONEXAO) {
    assert.ok(!/^amb|ambar|amarelo/i.test(cor.id), cor.id)
  }
})

// ── resolução por tema ───────────────────────────────────────────────

test('resolve a cor certa para cada tema', () => {
  assert.equal(corDaConexao('azul', 'dark'), '#477dd9')
  assert.equal(corDaConexao('azul', 'light'), '#4178d8')
})

test('conexão sem cor continua válida', () => {
  // O padrão é não ter cor: quem usa um banco só não ganha nada pintando.
  assert.equal(corDaConexao(undefined, 'dark'), undefined)
  assert.equal(corDaConexao('', 'light'), undefined)
})

test('id desconhecido não vira cor arbitrária', () => {
  // Um arquivo de conexões editado à mão, ou vindo de versão futura. Pintar de
  // qualquer cor faria duas conexões dividirem a mesma marca sem explicação.
  assert.equal(corDaConexao('turquesa-neon', 'dark'), undefined)
})

// ── sugestão automática ──────────────────────────────────────────────

test('a conexão nova nasce com uma cor ainda livre', () => {
  assert.equal(proximaCorLivre([]), 'vermelho')
  assert.equal(proximaCorLivre(['vermelho']), 'laranja')
  assert.equal(proximaCorLivre(['vermelho', 'laranja']), 'verde')
})

test('conexão sem cor não ocupa lugar na fila', () => {
  assert.equal(proximaCorLivre([undefined, 'vermelho', undefined]), 'laranja')
})

test('esgotadas as cores, repete em vez de ficar sem nenhuma', () => {
  const todas = CORES_DE_CONEXAO.map((c) => c.id)
  assert.equal(proximaCorLivre(todas), 'vermelho')
})
