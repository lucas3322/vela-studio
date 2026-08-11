/**
 * Regra de acúmulo das edições pendentes da grade.
 *
 * Vive fora do componente porque é onde o erro custa dado do usuário: o que
 * entra neste mapa é exatamente o que vira UPDATE no banco quando ele clica
 * em "Confirmar alterações".
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

interface ValorPendente {
  linha: number
  coluna: number
  nomeDaColuna: string
  valor: unknown
  anterior: unknown
}

/** Espelha o `encaixar` do EditableGrid. */
function encaixar(
  pendentes: Record<string, ValorPendente>,
  original: unknown,
  linha: number,
  coluna: number,
  nomeDaColuna: string,
  novo: unknown
): Record<string, ValorPendente> {
  const marca = `${linha}:${coluna}`
  // O "anterior" é sempre o valor do banco, nunca o pendente intermediário.
  const deOrigem = marca in pendentes ? pendentes[marca].anterior : original
  if (novo === deOrigem) {
    const copia = { ...pendentes }
    delete copia[marca]
    return copia
  }
  return { ...pendentes, [marca]: { linha, coluna, nomeDaColuna, valor: novo, anterior: deOrigem } }
}

test('editar uma célula cria uma pendência', () => {
  const p = encaixar({}, 'Ana', 0, 1, 'nome', 'Bruna')
  assert.equal(Object.keys(p).length, 1)
  assert.equal(p['0:1'].valor, 'Bruna')
  assert.equal(p['0:1'].anterior, 'Ana')
})

test('editar duas vezes mantém o valor original como anterior', () => {
  // Se o segundo encaixe sobrescrevesse `anterior` com "Bruna", descartar
  // deixaria a célula em "Bruna" — um valor que nunca existiu no banco.
  let p = encaixar({}, 'Ana', 0, 1, 'nome', 'Bruna')
  p = encaixar(p, 'Ana', 0, 1, 'nome', 'Carla')

  assert.equal(Object.keys(p).length, 1, 'continua sendo uma pendência só')
  assert.equal(p['0:1'].valor, 'Carla')
  assert.equal(p['0:1'].anterior, 'Ana', 'o anterior é o do banco, não o passo do meio')
})

test('voltar ao valor original remove a pendência', () => {
  // Sem isto, a barra diria "1 célula alterada" para uma célula idêntica ao
  // banco, e o Confirmar dispararia um UPDATE inútil.
  let p = encaixar({}, 'Ana', 0, 1, 'nome', 'Bruna')
  p = encaixar(p, 'Ana', 0, 1, 'nome', 'Ana')
  assert.deepEqual(p, {})
})

test('células diferentes acumulam separadamente', () => {
  let p = encaixar({}, 'Ana', 0, 1, 'nome', 'Bruna')
  p = encaixar(p, 'x@y.com', 0, 2, 'email', 'novo@y.com')
  p = encaixar(p, 'Bruno', 1, 1, 'nome', 'Bruno Silva')

  assert.equal(Object.keys(p).length, 3)
  assert.deepEqual(Object.keys(p).sort(), ['0:1', '0:2', '1:1'])
})

test('NULL é uma alteração válida, não um descarte', () => {
  const p = encaixar({}, 'ana@x.com', 0, 2, 'email', null)
  assert.equal(Object.keys(p).length, 1)
  assert.equal(p['0:2'].valor, null)
})

test('limpar uma célula que já era NULL não gera pendência', () => {
  const p = encaixar({}, null, 0, 2, 'email', null)
  assert.deepEqual(p, {})
})
