import type { ConnectionConfig, DriverId, TestResult } from '../shared/types'
import type { DatabaseDriver } from './drivers/types'
import { MySQLDriver } from './drivers/mysql'
import { PostgresDriver } from './drivers/postgres'
import { SQLiteDriver } from './drivers/sqlite'
import { MongoDriver } from './drivers/mongodb'
import { RedisDriver } from './drivers/redis'
import { configPeloTunel, destinoDoTunel } from './ssh-destino'
import { abrirTunel, type TunelSsh } from './ssh-tunnel'

function createDriver(id: DriverId): DatabaseDriver {
  switch (id) {
    case 'mysql': return new MySQLDriver()
    case 'postgres': return new PostgresDriver()
    case 'sqlite': return new SQLiteDriver()
    case 'mongodb': return new MongoDriver()
    case 'redis': return new RedisDriver()
    default: throw new Error(`Driver desconhecido: ${id}`)
  }
}

interface ActiveConnection {
  driver: DatabaseDriver
  config: ConnectionConfig
  /** Túnel SSH por baixo desta conexão, quando ela usa um. */
  tunel?: TunelSsh
}

/**
 * Abre o túnel, quando a conexão pede um, e devolve a config que o driver deve
 * receber — igual à original, com o endereço apontando para a porta local.
 *
 * É o único lugar que sabe que túnel existe. Os drivers recebem uma config
 * comum e não mudam nada: um MySQL por túnel é, para o driver, um MySQL em
 * `127.0.0.1`.
 */
async function prepararTunel(
  config: ConnectionConfig
): Promise<{ configDoDriver: ConnectionConfig; tunel?: TunelSsh }> {
  // SQLite é um arquivo local: não há para onde levar um túnel.
  if (!config.ssh?.enabled || config.driver === 'sqlite') return { configDoDriver: config }
  const tunel = await abrirTunel(config.ssh, destinoDoTunel(config))
  return { configDoDriver: configPeloTunel(config, tunel.porta), tunel }
}

/**
 * Mantém as sessões abertas. Várias conexões podem coexistir — a UI tem abas —
 * então guardamos por id, não uma só global.
 */
export class ConnectionManager {
  private active = new Map<string, ActiveConnection>()

  /**
   * Abre a conexão. Devolve a impressão digital do servidor SSH quando há
   * túnel, para quem chama guardá-la na primeira vez (ver `SshTunnelConfig`).
   */
  async open(config: ConnectionConfig): Promise<{ impressaoDigitalSsh?: string }> {
    await this.close(config.id)
    const { configDoDriver, tunel } = await prepararTunel(config)
    const driver = createDriver(config.driver)
    try {
      await driver.connect(configDoDriver)
    } catch (erro) {
      // Sem fechar aqui, cada tentativa com senha errada do banco deixaria um
      // túnel SSH aberto para trás, e uma porta local ocupada.
      await driver.disconnect().catch(() => undefined)
      await tunel?.fechar()
      throw erro
    }
    this.active.set(config.id, { driver, config, tunel })
    return { impressaoDigitalSsh: tunel?.impressaoDigital }
  }

  async close(id: string): Promise<void> {
    const connection = this.active.get(id)
    if (!connection) return
    await connection.driver.disconnect().catch(() => undefined)
    await connection.tunel?.fechar().catch(() => undefined)
    this.active.delete(id)
  }

  /**
   * Por que o túnel desta conexão caiu, se caiu.
   *
   * Quando o SSH cai, a próxima consulta falha com um erro de rede do driver —
   * "Connection lost", "ECONNRESET" — que não fala de túnel nenhum. Quem trata
   * o erro da consulta usa isto para dizer a causa de verdade.
   */
  motivoDaQuedaDoTunel(id: string): string | undefined {
    return this.active.get(id)?.tunel?.motivoDaQueda()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.close(id)))
  }

  get(id: string): ActiveConnection {
    const connection = this.active.get(id)
    if (!connection) {
      throw new Error('Conexão não está aberta. Conecte novamente na barra lateral.')
    }
    return connection
  }

  has(id: string): boolean {
    return this.active.has(id)
  }

  /** Teste isolado: cria um driver descartável, sem tocar nas sessões abertas. */
  async test(config: ConnectionConfig): Promise<TestResult> {
    let preparo: Awaited<ReturnType<typeof prepararTunel>>
    try {
      preparo = await prepararTunel(config)
    } catch (erro) {
      // O erro do túnel já vem em português e com a causa; marcado para não
      // passar pelo tradutor de erro de banco, que não o entenderia.
      return { ok: false, message: (erro as Error).message, falhaNoTunel: true }
    }
    const driver = createDriver(config.driver)
    try {
      const resultado = await driver.testConnection(preparo.configDoDriver)
      if (resultado.ok && preparo.tunel) {
        // A impressão digital aparece no teste para ser conferida com quem
        // administra o servidor, antes de a IDE passar a confiar nela.
        return {
          ...resultado,
          message: `${resultado.message} pelo túnel SSH. Chave do servidor: ${preparo.tunel.impressaoDigital}`
        }
      }
      return resultado
    } finally {
      await driver.disconnect().catch(() => undefined)
      await preparo.tunel?.fechar().catch(() => undefined)
    }
  }
}
