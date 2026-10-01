/**
 * Data e fuso horário, iguais no main e no renderer.
 *
 * ## A regra que isto implementa
 *
 * Existem dois tipos de "data" em banco, e confundir um com o outro era o bug:
 *
 * - **Relógio de parede** — `DATETIME` e `DATE` do MySQL, `timestamp` e `date`
 *   do PostgreSQL. O banco guarda "10:00" e não sabe de fuso nenhum. A IDE
 *   mostra e grava exatamente o texto que está lá, **sem passar por `Date`**.
 * - **Instante** — `TIMESTAMP` do MySQL, `timestamptz` do PostgreSQL, `Date`
 *   do MongoDB. O banco guarda um ponto na linha do tempo. A IDE mostra esse
 *   ponto no fuso da sessão — por padrão, o do computador de quem está usando.
 *
 * ## O bug que originou isto
 *
 * O driver transformava o `DATETIME` "10:00" num `Date` no fuso do Mac (10:00
 * de São Paulo = 13:00 UTC) e a tela imprimia com `toISOString()` — em UTC.
 * Resultado: a grade mostrava 13:00, a coluna `DATE` ganhava um horário
 * inventado (03:00), e abrir a célula e confirmar sem mudar nada gravava 13:00
 * de volta no PostgreSQL. Três horas somadas por edição, sem aviso.
 *
 * Tudo aqui recebe o fuso por parâmetro, nunca lê o do processo por conta
 * própria — é o que deixa os testes valerem em qualquer máquina da CI.
 */

/** O fuso do computador, no nome IANA (`America/Sao_Paulo`). */
export function fusoDoComputador(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

interface PartesDoRelogio {
  ano: number
  mes: number
  dia: number
  hora: number
  minuto: number
  segundo: number
}

/** O relógio de parede de `fuso` no instante dado. */
function relogioEm(instante: Date, fuso: string): PartesDoRelogio {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(instante)
  const valor = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value ?? 0)
  return {
    ano: valor('year'),
    mes: valor('month'),
    dia: valor('day'),
    hora: valor('hour'),
    minuto: valor('minute'),
    segundo: valor('second')
  }
}

/**
 * Quantos minutos `fuso` está à frente de UTC naquele instante.
 *
 * Negativo a oeste: São Paulo dá -180. Depende do instante porque horário de
 * verão existe — o mesmo fuso tem dois deslocamentos no mesmo ano.
 */
export function deslocamentoEm(fuso: string, instante: Date): number {
  const r = relogioEm(instante, fuso)
  const comoUtc = Date.UTC(r.ano, r.mes - 1, r.dia, r.hora, r.minuto, r.segundo)
  const semMs = Math.floor(instante.getTime() / 1000) * 1000
  return Math.round((comoUtc - semMs) / 60000)
}

/** `-180` → `"-03:00"`. É a forma que o MySQL aceita em `SET time_zone`. */
export function deslocamentoComoTexto(minutos: number): string {
  const sinal = minutos < 0 ? '-' : '+'
  const absoluto = Math.abs(minutos)
  const horas = String(Math.floor(absoluto / 60)).padStart(2, '0')
  const resto = String(absoluto % 60).padStart(2, '0')
  return `${sinal}${horas}:${resto}`
}

const dd = (n: number): string => String(n).padStart(2, '0')

/**
 * O instante como o relógio de parede de `fuso`: `2025-08-01 07:00:00`.
 *
 * Milissegundo só aparece quando existe — `.000` em toda célula seria ruído,
 * mas esconder um `.250` que está gravado seria mentir sobre o dado.
 */
export function formatarInstante(instante: Date, fuso: string): string {
  if (Number.isNaN(instante.getTime())) return String(instante)
  const r = relogioEm(instante, fuso)
  const base = `${r.ano}-${dd(r.mes)}-${dd(r.dia)} ${dd(r.hora)}:${dd(r.minuto)}:${dd(r.segundo)}`
  const ms = instante.getUTCMilliseconds()
  return ms ? `${base}.${String(ms).padStart(3, '0')}` : base
}

/**
 * Formas de data que alguém digita num filtro: `2025-08-01`,
 * `2025-08-01 14:30`, `2025-08-01 14:30:15`, com `T` no lugar do espaço.
 */
const DATA_DIGITADA =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/

/**
 * Texto de data lido no relógio de `fuso` → ISO com o deslocamento **escrito**.
 *
 * `"2025-08-01 00:00"` em São Paulo vira `"2025-08-01T00:00:00-03:00"`. O
 * deslocamento fica no texto de propósito: a prévia do filtro mostra qual
 * instante vai ser consultado, em vez de deixar o fuso implícito na conversão.
 *
 * Devolve `null` quando o texto não tem forma de data — quem chama decide o que
 * fazer, em vez de receber uma data inventada.
 */
export function paraIsoComDeslocamento(texto: string, fuso: string): string | null {
  const m = DATA_DIGITADA.exec(texto.trim())
  if (!m) return null
  const [ano, mes, dia, hora = 0, minuto = 0, segundo = 0] = m.slice(1).map((v) => Number(v ?? 0))
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) {
    return null
  }

  // O relógio pedido, lido como se fosse UTC; depois corrigido pelo
  // deslocamento que o fuso tem **naquele** instante. Duas passadas acertam a
  // virada do horário de verão, onde o deslocamento de "agora" seria o errado.
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto, segundo)
  const primeira = deslocamentoEm(fuso, new Date(comoUtc))
  const deslocamento = deslocamentoEm(fuso, new Date(comoUtc - primeira * 60000))

  return (
    `${ano}-${dd(mes)}-${dd(dia)}T${dd(hora)}:${dd(minuto)}:${dd(segundo)}` +
    deslocamentoComoTexto(deslocamento)
  )
}

/**
 * Em que fuso o MongoDB mostra e lê datas, conforme a conexão.
 *
 * O Mongo não tem fuso de sessão como os bancos SQL: a `Date` dele é sempre um
 * instante em UTC, e quem escolhe o relógio em que ela aparece é quem mostra.
 * Por isso a mesma escolha da conexão decide aqui — `local` é o fuso do
 * computador, `server` é UTC. Grade, documento, exportação e filtro leem
 * daqui, para as quatro telas nunca discordarem sobre a mesma data.
 */
export function fusoDoMongo(config: { sessionTimeZone?: 'local' | 'server' } | undefined): string {
  return config?.sessionTimeZone === 'server' ? 'UTC' : fusoDoComputador()
}
