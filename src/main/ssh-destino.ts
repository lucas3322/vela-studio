import { DRIVERS, type ConnectionConfig } from '../shared/types.ts'

/**
 * Para onde o túnel SSH leva, e como a conexão do driver passa a apontar para ele.
 *
 * O driver não sabe que existe túnel. Ele recebe uma config igual à de sempre,
 * só que com o endereço trocado para `127.0.0.1:<porta local do túnel>`. É o
 * que deixa os quatro drivers intactos — e o que faz um bug de túnel morar num
 * lugar só.
 *
 * Nada aqui abre conexão: é só reescrita de endereço, testável sem rede.
 */

export interface Destino {
  host: string
  port: number
}

/** Erro de configuração do túnel, com a mensagem já pronta para a tela. */
export class ErroDoTunel extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDoTunel'
  }
}

interface UriPartida {
  esquema: string
  /** Usuário e senha, **sem mexer** na codificação — reescrever quebraria senha com `@`. */
  credenciais?: string
  hosts: string[]
  /** `/banco?opcoes#...`, intacto. */
  resto: string
}

/**
 * Parte uma string de conexão à mão, sem `new URL`.
 *
 * O `URL` do WHATWG recodifica usuário e senha — uma senha com `%` ou `@`
 * sairia diferente de como entrou — e não aceita a lista de hosts do Mongo
 * (`mongodb://a:1,b:2`). Aqui cada pedaço sai exatamente como veio.
 */
function partirUri(uri: string): UriPartida | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:([^/?#]*)@)?([^/?#]*)(.*)$/i.exec(uri.trim())
  if (!m) return null
  return { esquema: m[1].toLowerCase(), credenciais: m[2], hosts: m[3].split(','), resto: m[4] }
}

function partirHost(texto: string, portaPadrao: number): Destino {
  // IPv6 vem entre colchetes: [::1]:5432
  const ipv6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(texto)
  if (ipv6) return { host: ipv6[1], port: Number(ipv6[2] ?? portaPadrao) }
  const [host, porta] = texto.split(':')
  return { host: host || 'localhost', port: Number(porta || portaPadrao) }
}

function portaPadrao(config: ConnectionConfig): number {
  return DRIVERS[config.driver].defaultPort ?? 0
}

/**
 * O endereço do banco que o **servidor SSH** vai procurar.
 *
 * Recusa o que um túnel não consegue atender, com a razão escrita, em vez de
 * deixar o driver falhar depois com um erro de rede que não diz nada.
 */
export function destinoDoTunel(config: ConnectionConfig): Destino {
  const uri = config.connectionString?.trim()
  if (!uri) {
    return { host: config.host?.trim() || 'localhost', port: config.port || portaPadrao(config) }
  }

  const partes = partirUri(uri)
  if (!partes) throw new ErroDoTunel('Não consegui ler a string de conexão para montar o túnel SSH.')

  if (partes.esquema === 'mongodb+srv') {
    throw new ErroDoTunel(
      'String mongodb+srv:// não funciona por túnel SSH: ela é resolvida por DNS em vários servidores, ' +
        'e o túnel leva a um só. Use mongodb://host-do-primario:27017 — a IDE liga o directConnection sozinha.'
    )
  }
  if (partes.hosts.length > 1) {
    throw new ErroDoTunel(
      `A string de conexão tem ${partes.hosts.length} servidores, e o túnel SSH leva a um só. ` +
        'Deixe apenas o host do primário.'
    )
  }
  return partirHost(partes.hosts[0], portaPadrao(config))
}

/**
 * Garante `directConnection=true` numa string do Mongo.
 *
 * Sem ele, o driver do Mongo pergunta ao servidor quem são os membros do
 * replica set e tenta falar com cada um **pelo nome que o servidor anuncia** —
 * nomes da rede interna, que daqui só existem do outro lado do túnel. A conexão
 * falharia depois de 30 segundos com "server selection timed out".
 */
function comConexaoDireta(resto: string): string {
  if (/[?&]directConnection=/i.test(resto)) return resto
  if (resto.includes('?')) return `${resto}&directConnection=true`
  const barra = resto.startsWith('/') ? resto : `/${resto}`
  return `${barra}?directConnection=true`
}

/** A config que o driver recebe: igual à original, apontando para o túnel. */
export function configPeloTunel(config: ConnectionConfig, portaLocal: number): ConnectionConfig {
  const local = `127.0.0.1:${portaLocal}`
  const uri = config.connectionString?.trim()

  if (uri) {
    const partes = partirUri(uri)!
    const credenciais = partes.credenciais !== undefined ? `${partes.credenciais}@` : ''
    const resto = config.driver === 'mongodb' ? comConexaoDireta(partes.resto) : partes.resto
    return { ...config, connectionString: `${partes.esquema}://${credenciais}${local}${resto}` }
  }

  if (config.driver === 'mongodb') {
    // O driver do Mongo monta a string a partir de host e porta, sem opção
    // nenhuma — e o túnel precisa do `directConnection`. A string é montada
    // aqui do mesmo jeito que `MongoDriver.buildUri` monta a dele.
    const credenciais = config.user
      ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@`
      : ''
    return { ...config, connectionString: `mongodb://${credenciais}${local}/?directConnection=true` }
  }

  return { ...config, host: '127.0.0.1', port: portaLocal }
}
