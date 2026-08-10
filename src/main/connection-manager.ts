import type { ConnectionConfig, DriverId, TestResult } from '../shared/types'
import type { DatabaseDriver } from './drivers/types'
import { MySQLDriver } from './drivers/mysql'
import { PostgresDriver } from './drivers/postgres'
import { SQLiteDriver } from './drivers/sqlite'
import { MongoDriver } from './drivers/mongodb'

function createDriver(id: DriverId): DatabaseDriver {
  switch (id) {
    case 'mysql': return new MySQLDriver()
    case 'postgres': return new PostgresDriver()
    case 'sqlite': return new SQLiteDriver()
    case 'mongodb': return new MongoDriver()
    default: throw new Error(`Driver desconhecido: ${id}`)
  }
}

interface ActiveConnection {
  driver: DatabaseDriver
  config: ConnectionConfig
}

/**
 * Mantém as sessões abertas. Várias conexões podem coexistir — a UI tem abas —
 * então guardamos por id, não uma só global.
 */
export class ConnectionManager {
  private active = new Map<string, ActiveConnection>()

  async open(config: ConnectionConfig): Promise<void> {
    await this.close(config.id)
    const driver = createDriver(config.driver)
    await driver.connect(config)
    this.active.set(config.id, { driver, config })
  }

  async close(id: string): Promise<void> {
    const connection = this.active.get(id)
    if (!connection) return
    await connection.driver.disconnect().catch(() => undefined)
    this.active.delete(id)
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
    const driver = createDriver(config.driver)
    try {
      return await driver.testConnection(config)
    } finally {
      await driver.disconnect().catch(() => undefined)
    }
  }
}
