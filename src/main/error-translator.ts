import type { DriverId, QueryError } from '../shared/types'

/**
 * Erro de banco é escrito para quem já sabe o que errou.
 * Aqui reescrevemos em português e, quando dá, sugerimos a correção —
 * é o que separa "ER_BAD_FIELD_ERROR" de "a coluna `nomee` não existe, você quis dizer `nome`?".
 */

interface Rule {
  match: (error: DriverError) => boolean
  translate: (error: DriverError, context: TranslationContext) => { friendly: string; hint?: string }
}

interface DriverError {
  message: string
  code?: string
  errno?: number
  position?: string | number
}

export interface TranslationContext {
  driver: DriverId
  /** Nomes conhecidos do schema, usados pra sugerir "você quis dizer". */
  knownTables?: string[]
  knownColumns?: string[]
}

const rules: Rule[] = [
  {
    match: (e) => /ECONNREFUSED/.test(e.message) || e.code === 'ECONNREFUSED',
    translate: () => ({
      friendly: 'O banco recusou a conexão — nada está escutando nesse host e porta.',
      hint: 'Confira se o servidor está no ar, se o host e a porta estão certos, e se há VPN ou firewall no caminho.'
    })
  },
  {
    match: (e) => /ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(e.message),
    translate: () => ({
      friendly: 'A conexão expirou antes de o banco responder.',
      hint: 'Normalmente é rede: VPN desconectada, IP não liberado no firewall, ou host errado.'
    })
  },
  {
    match: (e) => /ENOTFOUND|getaddrinfo/i.test(e.message),
    translate: (e) => ({
      friendly: 'O endereço do servidor não foi encontrado no DNS.',
      hint: `Verifique se o host está escrito corretamente${extractQuoted(e.message) ? `: "${extractQuoted(e.message)}"` : '.'}`
    })
  },
  {
    match: (e) => e.code === 'ER_ACCESS_DENIED_ERROR' || /password authentication failed|authentication failed/i.test(e.message),
    translate: () => ({
      friendly: 'Usuário ou senha incorretos.',
      hint: 'Se a senha tem caracteres especiais e você usou string de conexão, ela precisa estar codificada (% escapes).'
    })
  },
  {
    match: (e) => e.code === 'ER_BAD_DB_ERROR' || /database ".*" does not exist/i.test(e.message),
    translate: (e) => ({
      friendly: `O banco ${extractQuoted(e.message) ? `"${extractQuoted(e.message)}"` : 'informado'} não existe nesse servidor.`,
      hint: 'Confira o nome na tela de conexão — nomes de banco costumam ser sensíveis a maiúsculas.'
    })
  },
  {
    match: (e) => e.code === 'ER_NO_SUCH_TABLE' || /relation ".*" does not exist|no such table/i.test(e.message),
    translate: (e, ctx) => {
      const name = extractQuoted(e.message) ?? extractAfter(e.message, /table\s+'?([\w.]+)'?/i)
      // O banco reporta `db.contract`; o schema conhece só `contract`.
      // Comparar com o prefixo junto joga a distância de Levenshtein pra longe demais.
      const bare = name?.split('.').pop()
      const suggestion = bare ? nearest(bare, ctx.knownTables ?? []) : undefined
      return {
        friendly: `A tabela ${name ? `"${name}"` : 'referenciada'} não existe nesse banco.`,
        hint: suggestion
          ? `Você quis dizer "${suggestion}"?`
          : 'Veja a lista de tabelas na barra lateral — talvez ela esteja em outro banco ou schema.'
      }
    }
  },
  {
    match: (e) => e.code === 'ER_BAD_FIELD_ERROR' || /column ".*" does not exist|no such column/i.test(e.message),
    translate: (e, ctx) => {
      const name = extractQuoted(e.message) ?? extractAfter(e.message, /column\s+'?([\w.]+)'?/i)
      const suggestion = name ? nearest(name.split('.').pop()!, ctx.knownColumns ?? []) : undefined
      return {
        friendly: `A coluna ${name ? `"${name}"` : 'referenciada'} não existe.`,
        hint: suggestion
          ? `Você quis dizer "${suggestion}"?`
          : 'Expanda a tabela na barra lateral para ver os nomes exatos das colunas.'
      }
    }
  },
  {
    match: (e) => e.code === 'ER_PARSE_ERROR' || /syntax error at or near/i.test(e.message),
    translate: (e) => {
      const near = extractAfter(e.message, /at or near "([^"]+)"/i) ?? extractAfter(e.message, /near '([^']+)'/i)
      return {
        friendly: near
          ? `Erro de sintaxe perto de "${near}".`
          : 'A query tem um erro de sintaxe.',
        hint: 'Causas comuns: vírgula sobrando antes do FROM, aspas não fechadas, ou palavra-chave escrita errado.'
      }
    }
  },
  {
    match: (e) => e.code === 'ER_DUP_ENTRY' || /duplicate key value violates unique constraint/i.test(e.message),
    translate: (e) => ({
      friendly: 'Já existe um registro com esse valor em uma coluna que exige valores únicos.',
      hint: extractQuoted(e.message)
        ? `A restrição violada foi "${extractQuoted(e.message)}".`
        : 'Procure o registro existente antes de inserir, ou use UPSERT.'
    })
  },
  {
    match: (e) => e.code === 'ER_NO_REFERENCED_ROW_2' || /violates foreign key constraint/i.test(e.message),
    translate: () => ({
      friendly: 'O valor informado não existe na tabela referenciada pela chave estrangeira.',
      hint: 'Insira primeiro o registro na tabela pai, ou corrija o ID informado.'
    })
  },
  {
    match: (e) => /violates not-null constraint|cannot be null/i.test(e.message),
    translate: (e) => ({
      friendly: `A coluna ${extractQuoted(e.message) ? `"${extractQuoted(e.message)}"` : 'obrigatória'} não aceita valor nulo.`,
      hint: 'Informe um valor para essa coluna ou defina um DEFAULT no schema.'
    })
  },
  {
    match: (e) => /permission denied|command denied|not authorized/i.test(e.message),
    translate: () => ({
      friendly: 'Seu usuário não tem permissão para essa operação.',
      hint: 'Peça a liberação ao administrador do banco, ou use um usuário com mais privilégios.'
    })
  },
  {
    match: (e) => /somente-leitura/i.test(e.message),
    translate: (e) => ({
      friendly: e.message,
      hint: 'Desmarque "Somente leitura" nas configurações desta conexão se realmente quiser escrever.'
    })
  },
  {
    match: (e) => /Topology is closed|MongoServerSelectionError/i.test(e.message),
    translate: () => ({
      friendly: 'Não foi possível alcançar nenhum servidor do cluster MongoDB.',
      hint: 'Em clusters Atlas, confirme se seu IP está na allowlist do projeto.'
    })
  },
  {
    match: (e) => /unknown operator|FieldPath|\$\w+ is not allowed/i.test(e.message),
    translate: (e) => ({
      friendly: `O MongoDB rejeitou o operador usado: ${e.message}`,
      hint: 'Operadores começam com $ e vão dentro do objeto de filtro: { idade: { $gt: 18 } }.'
    })
  }
]

export function translateError(error: unknown, context: TranslationContext): QueryError {
  const driverError: DriverError = {
    message: (error as Error)?.message ?? String(error),
    code: (error as { code?: string }).code,
    errno: (error as { errno?: number }).errno,
    position: (error as { position?: string }).position
  }

  const rule = rules.find((r) => r.match(driverError))
  const translated = rule?.translate(driverError, context)

  return {
    raw: driverError.message,
    friendly: translated?.friendly ?? driverError.message,
    hint: translated?.hint,
    code: driverError.code,
    position: driverError.position != null ? Number(driverError.position) - 1 : undefined
  }
}

function extractQuoted(message: string): string | undefined {
  return /['"`]([^'"`]+)['"`]/.exec(message)?.[1]
}

function extractAfter(message: string, pattern: RegExp): string | undefined {
  return pattern.exec(message)?.[1]
}

/** Distância de Levenshtein: barata o bastante para uma lista de schema. */
function distance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = curr
  }
  return prev[n]
}

/** Sugere o nome mais próximo, mas só se for próximo o bastante pra não confundir. */
export function nearest(target: string, candidates: string[]): string | undefined {
  const lower = target.toLowerCase()
  let best: string | undefined
  let bestScore = Infinity
  for (const candidate of candidates) {
    const score = distance(lower, candidate.toLowerCase())
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3))
  return bestScore <= limit ? best : undefined
}
