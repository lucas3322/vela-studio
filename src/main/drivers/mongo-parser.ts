import { ObjectId, Decimal128, Long, Binary, MinKey, MaxKey, Timestamp } from 'mongodb'

/**
 * Um comando do editor Mongo depois de interpretado.
 * Nada aqui toca o banco — é só a descrição do que fazer.
 */
export interface MongoPlan {
  collection: string
  method: string
  args: unknown[]
  /** Modificadores encadeados: .sort({}).limit(10) */
  chain: Array<{ name: string; args: unknown[] }>
  source: string
}

/**
 * Globais bloqueados: viram parâmetros `undefined` da função, o que os sombreia
 * dentro da expressão do usuário.
 *
 * Uma versão anterior usava `vm.runInNewContext`, que isola melhor — mas cria
 * um realm próprio, e todo objeto literal, array ou regex nascia com o
 * protótipo daquele realm. O serializador BSON usa `instanceof RegExp` e
 * `instanceof Date`, que retornam `false` entre realms: `find({ nome: /^Mar/ })`
 * era silenciosamente enviado como documento vazio. Correção passa por avaliar
 * no mesmo realm.
 *
 * O modelo de confiança sustenta a troca: o texto avaliado é o que o próprio
 * usuário digitou no editor — a mesma confiança que damos a um `DROP TABLE`
 * escrito na aba ao lado. O sombreamento existe contra engano, não contra ataque.
 */
const BLOCKED_GLOBALS = [
  'process', 'require', 'module', 'exports', 'globalThis', 'global',
  'Function', 'Buffer', 'fetch',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'
]
// `eval` e `import` ficam de fora porque strict mode proíbe usá-los como nome
// de parâmetro — a própria função não compilaria. Coerente com o modelo de
// confiança acima: o texto avaliado é o que o usuário escreveu.

/**
 * Avaliar a expressão do usuário é inevitável — a sintaxe do shell do Mongo é JavaScript.
 * O que fazemos é tirar o poder do ambiente: o `db` daqui não conecta em nada,
 * apenas grava a intenção de forma declarativa.
 */
export function parseMongoCommand(source: string): MongoPlan {
  const plans: MongoPlan[] = []

  const makeCursor = (plan: MongoPlan): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, prop: string | symbol) {
          if (prop === 'then') return undefined // não é promise; evita await acidental
          if (typeof prop === 'symbol') return () => '[cursor]'
          return (...args: unknown[]) => {
            plan.chain.push({ name: prop, args })
            return makeCursor(plan)
          }
        }
      }
    )

  const collectionProxy = (name: string): Record<string, unknown> =>
    new Proxy(
      {},
      {
        get(_target, method: string) {
          return (...args: unknown[]) => {
            const plan: MongoPlan = { collection: name, method, args, chain: [], source }
            plans.push(plan)
            return makeCursor(plan)
          }
        }
      }
    )

  const dbProxy = new Proxy(
    {
      getCollection: (name: string) => collectionProxy(name),
      /** db.getCollectionNames() vira um "método" sem coleção. */
      getCollectionNames: () => {
        const plan: MongoPlan = { collection: '', method: 'listCollections', args: [], chain: [], source }
        plans.push(plan)
        return makeCursor(plan)
      }
    },
    {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) return target[prop]
        return collectionProxy(prop)
      }
    }
  )

  const helpers: Record<string, unknown> = {
    db: dbProxy,
    ObjectId,
    ObjectID: ObjectId,
    Decimal128,
    NumberDecimal: (v: string) => Decimal128.fromString(String(v)),
    NumberLong: (v: string | number) => Long.fromString(String(v)),
    NumberInt: (v: string | number) => Number(v),
    Long,
    Binary,
    MinKey,
    MaxKey,
    Timestamp,
    ISODate: (v?: string) => (v ? new Date(v) : new Date()),
    /** Açúcar frequente em query de data. */
    now: () => new Date()
  }

  const trimmed = source.trim().replace(/;+\s*$/, '')
  if (!trimmed) throw new Error('Comando vazio')

  const names = [...Object.keys(helpers), ...BLOCKED_GLOBALS]
  const values = [...Object.values(helpers), ...BLOCKED_GLOBALS.map(() => undefined)]

  try {
    // Parênteses garantem que `{...}` no início seja lido como objeto, não bloco.
    // eslint-disable-next-line no-new-func
    const evaluate = new Function(...names, `'use strict'; return (${trimmed})`)
    evaluate(...values)
  } catch (error) {
    const message = (error as Error).message
    if (!plans.length) {
      throw new Error(
        `Não consegui interpretar o comando: ${message}\n` +
          'Formato esperado: db.colecao.find({ campo: "valor" })'
      )
    }
  }

  const plan = plans[plans.length - 1]
  if (!plan) {
    throw new Error(
      'Nenhuma operação encontrada. Comece com `db.` — por exemplo: db.usuarios.find({}).limit(20)'
    )
  }
  return plan
}

/** Quebra um script em comandos, um por linha lógica terminada em `;` ou quebra de linha. */
export function splitMongoCommands(source: string): string[] {
  const commands: string[] = []
  let current = ''
  let depth = 0
  let inString: string | null = null

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (inString) {
      current += char
      if (char === '\\') {
        current += source[++i] ?? ''
      } else if (char === inString) {
        inString = null
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = char
      current += char
      continue
    }
    if (char === '(' || char === '{' || char === '[') depth++
    if (char === ')' || char === '}' || char === ']') depth--

    if (char === ';' && depth === 0) {
      if (current.trim()) commands.push(current.trim())
      current = ''
      continue
    }
    if (char === '\n' && depth === 0 && current.trim() && /\)\s*$/.test(current)) {
      commands.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) commands.push(current.trim())
  return commands
}
