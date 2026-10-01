/**
 * Data e fuso: as regras de `src/shared/datas.ts`.
 *
 * Todo teste passa o fuso por parâmetro — nenhum depende do relógio da máquina
 * que roda a CI. É o mesmo cuidado que o código tem: o bug nasceu justamente de
 * uma conversão que usava o fuso do processo sem dizer.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deslocamentoComoTexto,
  deslocamentoEm,
  formatarInstante,
  paraIsoComDeslocamento
} from '../shared/datas.ts'

const SP = 'America/Sao_Paulo'
const INSTANTE = new Date('2025-08-01T10:00:00Z')

test('o instante aparece no relógio do fuso pedido, não em UTC', () => {
  // 10:00 UTC é 07:00 em São Paulo. Era isto que a tela errava: imprimia UTC
  // sem dizer, e a pessoa lia como hora local.
  assert.equal(formatarInstante(INSTANTE, SP), '2025-08-01 07:00:00')
  assert.equal(formatarInstante(INSTANTE, 'UTC'), '2025-08-01 10:00:00')
  assert.equal(formatarInstante(INSTANTE, 'Asia/Tokyo'), '2025-08-01 19:00:00')
})

test('o dia muda quando o fuso atravessa a meia-noite', () => {
  // 02:00 UTC ainda é o dia anterior em São Paulo. Uma coluna de data que
  // ignora isso mostra o dia errado — pior do que a hora errada.
  assert.equal(formatarInstante(new Date('2025-08-01T02:00:00Z'), SP), '2025-07-31 23:00:00')
})

test('milissegundo aparece só quando existe', () => {
  assert.equal(formatarInstante(new Date('2025-08-01T10:00:00.250Z'), 'UTC'), '2025-08-01 10:00:00.250')
  assert.equal(formatarInstante(new Date('2025-08-01T10:00:00.000Z'), 'UTC'), '2025-08-01 10:00:00')
})

test('data inválida não vira uma data inventada', () => {
  assert.equal(formatarInstante(new Date(Number.NaN), SP), 'Invalid Date')
})

test('deslocamento: São Paulo é -03:00, e o horário de verão é respeitado', () => {
  assert.equal(deslocamentoEm(SP, INSTANTE), -180)
  assert.equal(deslocamentoComoTexto(-180), '-03:00')
  assert.equal(deslocamentoComoTexto(330), '+05:30') // Índia: meia hora existe
  // Nova York: -04:00 no verão, -05:00 no inverno. O mesmo fuso, dois valores.
  assert.equal(deslocamentoEm('America/New_York', new Date('2025-07-01T12:00:00Z')), -240)
  assert.equal(deslocamentoEm('America/New_York', new Date('2025-01-01T12:00:00Z')), -300)
})

test('texto digitado vira ISO com o deslocamento escrito', () => {
  assert.equal(paraIsoComDeslocamento('2025-08-01 00:00:00', SP), '2025-08-01T00:00:00-03:00')
  assert.equal(paraIsoComDeslocamento('2025-08-01', SP), '2025-08-01T00:00:00-03:00')
  assert.equal(paraIsoComDeslocamento('2025-08-01T14:30', SP), '2025-08-01T14:30:00-03:00')
  assert.equal(paraIsoComDeslocamento('2025-08-01 00:00:00', 'UTC'), '2025-08-01T00:00:00+00:00')
})

test('a conversão ida e volta é fiel', () => {
  // O que a tela mostra, digitado de volta no filtro, tem que ser o mesmo
  // instante. Se não for, filtrar pelo valor que se está vendo não acha nada.
  const mostrado = formatarInstante(INSTANTE, SP)
  const digitado = paraIsoComDeslocamento(mostrado, SP)
  assert.equal(new Date(digitado!).getTime(), INSTANTE.getTime())
})

test('deslocamento certo dos dois lados da virada do horário de verão', () => {
  // Em 2025 Nova York mudou em 9 de março, às 02:00. Usar o deslocamento de
  // "agora" para uma data do outro lado da virada erraria em uma hora.
  assert.equal(paraIsoComDeslocamento('2025-03-08 12:00', 'America/New_York'), '2025-03-08T12:00:00-05:00')
  assert.equal(paraIsoComDeslocamento('2025-03-10 12:00', 'America/New_York'), '2025-03-10T12:00:00-04:00')
})

test('o que não tem forma de data devolve null, não um palpite', () => {
  assert.equal(paraIsoComDeslocamento('ontem', SP), null)
  assert.equal(paraIsoComDeslocamento('01/08/2025', SP), null)
  assert.equal(paraIsoComDeslocamento('2025-13-01', SP), null)
  assert.equal(paraIsoComDeslocamento('2025-08-01 25:00', SP), null)
})
