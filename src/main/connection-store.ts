import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import type { ConnectionConfig, HistoryEntry, SavedQuery, StoredConnection } from '../shared/types'
import { cifrarSenha, decifrarSenha, ehFormatoAntigo } from './password-crypto'

/**
 * Conexões e histórico em JSON no userData.
 * A senha nunca toca o disco em texto: passa pela cifra de `password-crypto`,
 * cuja chave fica num arquivo 0600 ao lado dos dados. Leia o cabeçalho daquele
 * arquivo antes de confiar nisso — é proteção contra leitura casual, não
 * contra quem tem acesso à conta.
 *
 * Já usamos o Chaveiro do macOS aqui. Saiu porque, sem certificado de
 * desenvolvedor, a assinatura do app muda a cada build e o macOS passa a pedir
 * a senha da conta a cada acesso.
 */
export class ConnectionStore {
  private readonly connectionsPath: string
  private readonly historyPath: string
  private readonly savedQueriesPath: string
  private readonly keyPath: string
  private connections: StoredConnection[] = []
  private history: HistoryEntry[] = []
  private savedQueries: SavedQuery[] = []

  constructor() {
    const dir = app.getPath('userData')
    this.connectionsPath = join(dir, 'connections.json')
    this.historyPath = join(dir, 'history.json')
    this.savedQueriesPath = join(dir, 'saved-queries.json')
    this.keyPath = join(dir, 'password.key')
    this.connections = this.read(this.connectionsPath, [])
    this.history = this.read(this.historyPath, [])
    this.savedQueries = this.read(this.savedQueriesPath, [])
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

  /**
   * Motivo pelo qual a última gravação de senha não aconteceu, se não aconteceu.
   *
   * Existe porque guardar a senha **não pode impedir de conectar**. Uma versão
   * anterior lançava erro aqui: como o `save` roda antes do `connect`, o
   * usuário deixava de conseguir abrir o banco por causa de um problema de
   * chaveiro. O erro virou aviso, e a conexão segue.
   */
  private ultimoAvisoDeSenha?: string

  private encrypt(password?: string): string | undefined {
    if (!password) return undefined
    try {
      return cifrarSenha(password, this.keyPath)
    } catch (error) {
      this.ultimoAvisoDeSenha = `Não consegui guardar a senha: ${(error as Error).message}`
      return undefined
    }
  }

  private decrypt(encrypted?: string): string | undefined {
    if (!encrypted) return undefined
    // Senha gravada pela versão que usava o Chaveiro. Decifrá-la exigiria
    // pedir acesso às Chaves de novo — exatamente o que saímos de lá para
    // evitar. Vale mais pedir a senha uma última vez.
    if (ehFormatoAntigo(encrypted)) return undefined
    return decifrarSenha(encrypted, this.keyPath)
  }

  /**
   * Lista para a UI.
   *
   * O texto cifrado nunca sai daqui: o renderer não tem o que fazer com ele e
   * mandá-lo para um processo que renderiza dado de terceiros é risco de graça.
   * No lugar vai `hasPassword`, que é a única coisa que a interface precisa
   * saber para decidir se pergunta a senha antes de conectar.
   */
  list(): StoredConnection[] {
    return [...this.connections]
      .sort((a, b) => (b.lastUsedAt ?? b.createdAt ?? 0) - (a.lastUsedAt ?? a.createdAt ?? 0))
      .map((registro) => this.paraUI(registro))
  }

  /**
   * Cache das senhas já decifradas nesta sessão.
   *
   * Vive apenas em memória — fecha o app, some. Existe para não reler e
   * redecifrar o arquivo a cada abertura de conexão.
   */
  private senhasNaMemoria = new Map<string, string | undefined>()

  /** Config completa, com senha, só para o main abrir a conexão. */
  resolve(id: string): ConnectionConfig | undefined {
    const stored = this.connections.find((c) => c.id === id)
    if (!stored) return undefined
    const { encryptedPassword, ...rest } = stored

    if (!this.senhasNaMemoria.has(id)) {
      this.senhasNaMemoria.set(id, this.decrypt(encryptedPassword))
    }
    return { ...rest, password: this.senhasNaMemoria.get(id) }
  }

  save(config: ConnectionConfig, savePassword = true): StoredConnection {
    this.ultimoAvisoDeSenha = undefined
    // `hasPassword` é derivado, e a UI devolve o objeto que recebeu do `list()`
    // com ele dentro. Sem descartar aqui, o valor obsoleto era gravado no JSON
    // e passava a divergir do que existe de fato.
    const { password, hasPassword: _derivado, ...rest } = config as ConnectionConfig & {
      hasPassword?: boolean
    }
    const existing = this.connections.find((c) => c.id === config.id)
    const stored: StoredConnection = {
      ...rest,
      createdAt: existing?.createdAt ?? Date.now(),
      encryptedPassword: savePassword
        ? this.encrypt(password) ?? existing?.encryptedPassword
        : undefined
    }
    this.senhasNaMemoria.delete(config.id)
    const index = this.connections.findIndex((c) => c.id === config.id)
    if (index >= 0) this.connections[index] = stored
    else this.connections.push(stored)
    this.write(this.connectionsPath, this.connections)

    // Mesma regra do `list()`: o texto cifrado não atravessa o IPC. O retorno
    // estava devolvendo `stored` cru, com `encryptedPassword` dentro —
    // contrariando em silêncio o que este arquivo promete logo acima.
    return { ...this.paraUI(stored), passwordWarning: this.ultimoAvisoDeSenha }
  }

  /** Versão segura de um registro: sem o cifrado, com o sinal que a UI usa. */
  private paraUI({ encryptedPassword, ...rest }: StoredConnection): StoredConnection {
    return { ...rest, hasPassword: !!encryptedPassword }
  }

  remove(id: string): void {
    this.senhasNaMemoria.delete(id)
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

  // ── Queries salvas ──────────────────────────────────────────────────

  listSavedQueries(connectionId?: string): SavedQuery[] {
    const lista = connectionId
      ? this.savedQueries.filter((q) => q.connectionId === connectionId)
      : this.savedQueries
    // Mais recente primeiro: quem salva costuma querer o que acabou de mexer.
    return [...lista].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Grava uma query. Com `id` existente, atualiza; sem, cria.
   *
   * `createdAt` é preservado na atualização — a lista mostra "há 2 meses" e
   * sobrescrever a data de criação a cada save faria toda query parecer nova.
   */
  saveQuery(entrada: Omit<SavedQuery, 'createdAt' | 'updatedAt'>): SavedQuery {
    const agora = Date.now()
    const anterior = this.savedQueries.find((q) => q.id === entrada.id)
    const registro: SavedQuery = {
      ...entrada,
      createdAt: anterior?.createdAt ?? agora,
      updatedAt: agora
    }

    this.savedQueries = anterior
      ? this.savedQueries.map((q) => (q.id === entrada.id ? registro : q))
      : [...this.savedQueries, registro]

    this.write(this.savedQueriesPath, this.savedQueries)
    return registro
  }

  removeSavedQuery(id: string): void {
    this.savedQueries = this.savedQueries.filter((q) => q.id !== id)
    this.write(this.savedQueriesPath, this.savedQueries)
  }
}
