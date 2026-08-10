import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ConnectionConfig, HistoryEntry, StoredConnection } from '../shared/types'

/**
 * Conexões e histórico em JSON no userData.
 * A senha nunca toca o disco em texto: passa por safeStorage, que no macOS
 * encosta no Keychain. Se a criptografia não estiver disponível (sessão sem
 * login gráfico, por exemplo), preferimos não salvar a senha a salvar exposta.
 */
export class ConnectionStore {
  private readonly connectionsPath: string
  private readonly historyPath: string
  private connections: StoredConnection[] = []
  private history: HistoryEntry[] = []

  constructor() {
    const dir = app.getPath('userData')
    this.connectionsPath = join(dir, 'connections.json')
    this.historyPath = join(dir, 'history.json')
    this.connections = this.read(this.connectionsPath, [])
    this.history = this.read(this.historyPath, [])
  }

  private read<T>(path: string, fallback: T): T {
    try {
      if (!existsSync(path)) return fallback
      return JSON.parse(readFileSync(path, 'utf-8')) as T
    } catch {
      return fallback
    }
  }

  private write(path: string, data: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
  }

  private encrypt(password?: string): string | undefined {
    if (!password) return undefined
    if (!safeStorage.isEncryptionAvailable()) return undefined
    return safeStorage.encryptString(password).toString('base64')
  }

  private decrypt(encrypted?: string): string | undefined {
    if (!encrypted) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  /** Lista para a UI: senha omitida, sempre. */
  list(): StoredConnection[] {
    return [...this.connections].sort(
      (a, b) => (b.lastUsedAt ?? b.createdAt ?? 0) - (a.lastUsedAt ?? a.createdAt ?? 0)
    )
  }

  /** Config completa, com senha, só para o main abrir a conexão. */
  resolve(id: string): ConnectionConfig | undefined {
    const stored = this.connections.find((c) => c.id === id)
    if (!stored) return undefined
    const { encryptedPassword, ...rest } = stored
    return { ...rest, password: this.decrypt(encryptedPassword) }
  }

  save(config: ConnectionConfig, savePassword = true): StoredConnection {
    const { password, ...rest } = config
    const existing = this.connections.find((c) => c.id === config.id)
    const stored: StoredConnection = {
      ...rest,
      createdAt: existing?.createdAt ?? Date.now(),
      encryptedPassword: savePassword
        ? this.encrypt(password) ?? existing?.encryptedPassword
        : undefined
    }
    const index = this.connections.findIndex((c) => c.id === config.id)
    if (index >= 0) this.connections[index] = stored
    else this.connections.push(stored)
    this.write(this.connectionsPath, this.connections)
    return stored
  }

  remove(id: string): void {
    this.connections = this.connections.filter((c) => c.id !== id)
    this.write(this.connectionsPath, this.connections)
  }

  touch(id: string): void {
    const connection = this.connections.find((c) => c.id === id)
    if (!connection) return
    connection.lastUsedAt = Date.now()
    this.write(this.connectionsPath, this.connections)
  }

  addHistory(entry: HistoryEntry): void {
    this.history.unshift(entry)
    // Teto de 500: o suficiente para achar aquela query de ontem sem virar um log infinito.
    if (this.history.length > 500) this.history.length = 500
    this.write(this.historyPath, this.history)
  }

  listHistory(connectionId?: string): HistoryEntry[] {
    return connectionId ? this.history.filter((h) => h.connectionId === connectionId) : this.history
  }

  clearHistory(): void {
    this.history = []
    this.write(this.historyPath, this.history)
  }
}
