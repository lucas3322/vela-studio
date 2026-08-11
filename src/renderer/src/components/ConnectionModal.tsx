import { useEffect, useState } from 'react'
import { DRIVERS, type ConnectionConfig, type DriverId, type TestResult } from '@shared/types'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import {
  IconCheck,
  IconClose,
  IconDatabase,
  IconEdit,
  IconTrash,
  IconView,
  IconViewOff,
  IconWarning
} from './Icons'
import { needsPassword } from './WelcomeScreen'

function emptyConfig(driver: DriverId = 'mysql'): ConnectionConfig {
  return {
    id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    driver,
    host: 'localhost',
    port: DRIVERS[driver].defaultPort,
    user: '',
    password: '',
    database: '',
    readOnly: false
  }
}

export function ConnectionModal(): React.JSX.Element {
  const { closeModal, editingConnectionId, notify } = useAppStore()
  const { saved, connect, removeConnection, refreshSaved } = useConnectionStore()

  const existing = saved.find((c) => c.id === editingConnectionId)
  const [config, setConfig] = useState<ConnectionConfig>(
    existing ? { ...existing, password: '' } : emptyConfig()
  )
  const [savePassword, setSavePassword] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [showList, setShowList] = useState(!editingConnectionId && saved.length > 0)
  const [senhaVisivel, setSenhaVisivel] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const meta = DRIVERS[config.driver]

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeModal])

  const update = (patch: Partial<ConnectionConfig>): void => {
    setConfig((current) => ({ ...current, ...patch }))
    setTestResult(null)
  }

  const changeDriver = (driver: DriverId): void => {
    // Trocar de driver reajusta a porta padrão, mas preserva o que já foi digitado.
    update({
      driver,
      port: DRIVERS[driver].defaultPort,
      host: config.host || 'localhost'
    })
  }

  const handleTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await window.vela.connections.test(config))
    } finally {
      setTesting(false)
    }
  }

  const handleConnect = async (): Promise<void> => {
    setConnecting(true)
    try {
      const name = config.name.trim() || suggestName(config)
      const finalConfig = { ...config, name }
      await window.vela.connections.save(finalConfig, savePassword)
      await connect(finalConfig)
      await refreshSaved()
      notify(`Conectado a ${name}`, 'success')
      closeModal()
    } catch (error) {
      notify((error as Error).message, 'danger')
      setTestResult({ ok: false, message: (error as Error).message })
    } finally {
      setConnecting(false)
    }
  }

  /**
   * Grava as alterações sem abrir a conexão.
   *
   * Faltava por completo: dava para editar o formulário, mas o único caminho
   * de saída era "Conectar". Quem queria só corrigir uma porta ou renomear
   * era obrigado a conectar no banco.
   */
  const handleSave = async (): Promise<void> => {
    setSalvando(true)
    try {
      const name = config.name.trim() || suggestName(config)
      await window.vela.connections.save({ ...config, name }, savePassword)
      await refreshSaved()
      notify(`Conexão "${name}" salva.`, 'success')
      setShowList(true)
    } catch (error) {
      notify((error as Error).message, 'danger')
    } finally {
      setSalvando(false)
    }
  }

  const handleConnectSaved = async (id: string): Promise<void> => {
    const stored = saved.find((c) => c.id === id)
    if (!stored) return

    // Sem senha guardada, abre o formulário desta conexão em vez de tentar
    // conectar e receber um "Access denied" que não diz o que fazer.
    if (needsPassword(stored)) {
      setConfig({ ...stored, password: '' })
      setShowList(false)
      return
    }

    setConnecting(true)
    try {
      await connect({ ...stored, password: undefined })
      notify(`Conectado a ${stored.name}`, 'success')
      closeModal()
    } catch (error) {
      notify((error as Error).message, 'danger')
    } finally {
      setConnecting(false)
    }
  }

  const shows = (field: string): boolean => meta.fields.includes(field as never)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div>
            <div className="modal__title">
              {showList ? 'Conexões' : existing ? 'Editar conexão' : 'Nova conexão'}
            </div>
            <div className="modal__subtitle">
              {showList
                ? `${saved.length} conexão(ões) salva(s)`
                : 'Os dados ficam no seu Mac; a senha vai criptografada no Keychain.'}
            </div>
          </div>
          <button className="icon-btn" onClick={closeModal}>
            <IconClose />
          </button>
        </div>

        {showList ? (
          <>
            <div className="modal__body" style={{ gap: 'var(--space-2)' }}>
              {saved.map((connection) => (
                <div key={connection.id} style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    className="welcome__item"
                    style={{ flex: 1 }}
                    onClick={() => void handleConnectSaved(connection.id)}
                    disabled={connecting}
                  >
                    <IconDatabase size={17} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span className="welcome__item-body">
                      <div className="welcome__item-name">{connection.name}</div>
                      <div className="welcome__item-meta">
                        {connection.filePath ??
                          `${connection.host}${connection.port ? `:${connection.port}` : ''}${
                            connection.database ? `/${connection.database}` : ''
                          }`}
                      </div>
                    </span>
                    <span className="badge">{DRIVERS[connection.driver].label.split(' ')[0]}</span>
                  </button>
                  <button
                    className="icon-btn"
                    title="Editar conexão"
                    onClick={() => {
                      // A senha não vem do store para o renderer; o campo abre
                      // vazio e, se não for digitada, a salva é preservada.
                      setConfig({ ...connection, password: '' })
                      setSenhaVisivel(false)
                      setTestResult(null)
                      setShowList(false)
                    }}
                  >
                    <IconEdit size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Remover conexão"
                    onClick={() => void removeConnection(connection.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="modal__footer">
              <button className="btn btn--secondary" onClick={closeModal}>
                Fechar
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  setConfig(emptyConfig())
                  setShowList(false)
                }}
              >
                Nova conexão
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal__body">
              <div className="field">
                <span className="field__label">Tipo de banco</span>
                <div className="driver-grid">
                  {Object.values(DRIVERS).map((driver) => (
                    <button
                      key={driver.id}
                      className={`driver-card ${config.driver === driver.id ? 'driver-card--selected' : ''}`}
                      onClick={() => changeDriver(driver.id)}
                    >
                      <span className="driver-card__name">{driver.label}</span>
                      <span className="driver-card__family">
                        {driver.family === 'sql' ? 'relacional' : 'documentos'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="field__label">Nome da conexão</span>
                <input
                  className="input"
                  placeholder={suggestName(config)}
                  value={config.name}
                  onChange={(e) => update({ name: e.target.value })}
                  autoFocus
                />
              </div>

              {shows('connectionString') && (
                <div className="field">
                  <span className="field__label">
                    String de conexão {config.driver === 'mongodb' ? '' : '(opcional)'}
                  </span>
                  <input
                    className="input"
                    placeholder={
                      config.driver === 'mongodb'
                        ? 'mongodb+srv://usuario:senha@cluster.mongodb.net'
                        : 'postgresql://usuario:senha@host:5432/banco'
                    }
                    value={config.connectionString ?? ''}
                    onChange={(e) => update({ connectionString: e.target.value })}
                  />
                  <span className="field__hint">
                    Preenchendo aqui, os campos abaixo são ignorados.
                  </span>
                </div>
              )}

              {shows('filePath') && (
                <div className="field">
                  <span className="field__label">Arquivo do banco</span>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      className="input"
                      placeholder="/caminho/para/banco.db"
                      value={config.filePath ?? ''}
                      onChange={(e) => update({ filePath: e.target.value })}
                    />
                    <button
                      className="btn btn--secondary"
                      onClick={async () => {
                        const file = await window.vela.app.pickFile()
                        if (file) update({ filePath: file, name: config.name || baseName(file) })
                      }}
                    >
                      Procurar…
                    </button>
                  </div>
                </div>
              )}

              {shows('host') && (
                <div className="form-grid form-grid--wide">
                  <div className="field">
                    <span className="field__label">Host</span>
                    <input
                      className="input"
                      value={config.host ?? ''}
                      onChange={(e) => update({ host: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <span className="field__label">Porta</span>
                    <input
                      className="input"
                      type="number"
                      value={config.port ?? ''}
                      onChange={(e) => update({ port: Number(e.target.value) })}
                    />
                  </div>
                </div>
              )}

              {shows('user') && (
                <div className="form-grid">
                  <div className="field">
                    <span className="field__label">Usuário</span>
                    <input
                      className="input"
                      value={config.user ?? ''}
                      onChange={(e) => update({ user: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <span className="field__label">Senha</span>
                    <div className="campo-senha">
                      <input
                        className="input"
                        type={senhaVisivel ? 'text' : 'password'}
                        placeholder={existing ? '••••••••  (salva)' : ''}
                        value={config.password ?? ''}
                        onChange={(e) => update({ password: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="campo-senha__olho"
                        onClick={() => setSenhaVisivel((v) => !v)}
                        title={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                        aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {senhaVisivel ? <IconViewOff size={15} /> : <IconView size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {shows('database') && (
                <div className="field">
                  <span className="field__label">
                    Banco {config.driver === 'mongodb' ? '' : 'padrão'}
                  </span>
                  <input
                    className="input"
                    placeholder="deixe vazio para escolher depois"
                    value={config.database ?? ''}
                    onChange={(e) => update({ database: e.target.value })}
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
                {shows('ssl') && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={!!config.ssl}
                      onChange={(e) => update({ ssl: e.target.checked })}
                    />
                    Usar SSL
                  </label>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!config.readOnly}
                    onChange={(e) => update({ readOnly: e.target.checked })}
                  />
                  Somente leitura
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={savePassword}
                    onChange={(e) => setSavePassword(e.target.checked)}
                  />
                  Salvar senha
                </label>
              </div>

              {existing && !existing.hasPassword && shows('password') && (
                <div className="field__hint" style={{ color: 'var(--warning)' }}>
                  Esta conexão não tem senha salva. Informe a senha e mantenha
                  "Salvar senha" marcado para não precisar digitá-la de novo.
                </div>
              )}

              {config.readOnly && (
                <div className="field__hint" style={{ color: 'var(--info)' }}>
                  Comandos de escrita ficam bloqueados. Recomendado para bancos de produção.
                </div>
              )}

              {testResult && (
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    background: testResult.ok ? 'var(--success-subtle)' : 'var(--danger-subtle)',
                    color: testResult.ok ? 'var(--success)' : 'var(--danger)',
                    fontSize: 'var(--text-sm)'
                  }}
                >
                  {testResult.ok ? <IconCheck size={15} /> : <IconWarning size={15} />}
                  <span className="selectable">
                    {testResult.message}
                    {testResult.serverVersion && ` · versão ${testResult.serverVersion}`}
                    {testResult.latencyMs != null && ` · ${testResult.latencyMs} ms`}
                  </span>
                </div>
              )}
            </div>

            <div className="modal__footer">
              {saved.length > 0 && (
                <button
                  className="btn btn--ghost modal__footer-left"
                  onClick={() => setShowList(true)}
                >
                  ← Ver salvas
                </button>
              )}
              <button
                className="btn btn--secondary"
                onClick={() => void handleTest()}
                disabled={testing || connecting || salvando}
              >
                {testing ? <span className="spinner" /> : null}
                {testing ? 'Testando…' : 'Testar'}
              </button>
              <button
                className="btn btn--secondary"
                onClick={() => void handleSave()}
                disabled={testing || connecting || salvando}
                title="Grava as alterações sem abrir a conexão"
              >
                {salvando ? <span className="spinner" /> : null}
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
              <button
                className="btn btn--primary"
                onClick={() => void handleConnect()}
                disabled={connecting || testing}
              >
                {connecting ? <span className="spinner" /> : null}
                {connecting ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Nome automático quando o usuário não digita nenhum. */
function suggestName(config: ConnectionConfig): string {
  if (config.filePath) return baseName(config.filePath)
  if (config.database) return config.database
  if (config.host) return `${config.host}${config.port ? `:${config.port}` : ''}`
  return DRIVERS[config.driver].label
}

function baseName(path: string): string {
  return path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? path
}
