import { useState } from 'react'
import type { SshTunnelConfig } from '@shared/types'
import { IconFolder, IconView, IconViewOff } from './Icons'

/**
 * A parte do formulário de conexão que configura o túnel SSH.
 *
 * Os segredos (senha SSH, senha da chave) seguem a mesma regra da senha do
 * banco: o campo abre sempre vazio, porque o segredo guardado nunca volta para
 * a tela. Vazio quer dizer "mantenha o que está guardado" — e o placeholder diz
 * quando há algo guardado, para ninguém redigitar à toa nem achar que perdeu.
 */

interface Props {
  ssh: SshTunnelConfig | undefined
  onChange: (ssh: SshTunnelConfig) => void
  /** Conexão já existe no disco: só aí há chave de servidor para esquecer. */
  podeEsquecerChave: boolean
  onEsquecerChave: () => void
}

const NOVO: SshTunnelConfig = { enabled: true, host: '', port: 22, user: '', auth: 'password' }

export function SshTunnelFields({
  ssh,
  onChange,
  podeEsquecerChave,
  onEsquecerChave
}: Props): React.JSX.Element {
  const ativo = !!ssh?.enabled
  const atual = ssh ?? NOVO
  const trocar = (patch: Partial<SshTunnelConfig>): void => onChange({ ...atual, ...patch })

  const escolherChave = async (): Promise<void> => {
    const caminho = await window.vela.app.pickFile([{ name: 'Chave privada', extensions: ['*'] }], {
      pastaInicial: '~/.ssh',
      mostrarOcultos: true
    })
    if (caminho) trocar({ privateKeyPath: caminho })
  }

  return (
    <div className="tunel">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => onChange({ ...atual, enabled: e.target.checked })}
        />
        Conectar por túnel SSH
      </label>

      {ativo && (
        <div className="tunel__corpo">
          <div className="form-grid form-grid--wide">
            <div className="field">
              <span className="field__label">Servidor SSH</span>
              <input
                className="input"
                placeholder="bastion.empresa.com"
                value={atual.host}
                onChange={(e) => trocar({ host: e.target.value })}
                spellCheck={false}
              />
            </div>
            <div className="field">
              <span className="field__label">Porta</span>
              <input
                className="input"
                type="number"
                value={atual.port ?? 22}
                onChange={(e) => trocar({ port: Number(e.target.value) || undefined })}
              />
            </div>
          </div>

          <div className="field">
            <span className="field__label">Usuário SSH</span>
            <input
              className="input"
              value={atual.user}
              onChange={(e) => trocar({ user: e.target.value })}
              spellCheck={false}
            />
          </div>

          <div className="field">
            <span className="field__label">Autenticação</span>
            <span className="segmented" role="group" aria-label="Autenticação SSH">
              <button type="button" data-active={atual.auth === 'password'} onClick={() => trocar({ auth: 'password' })}>
                Senha
              </button>
              <button type="button" data-active={atual.auth === 'key'} onClick={() => trocar({ auth: 'key' })}>
                Chave privada
              </button>
              <button type="button" data-active={atual.auth === 'agent'} onClick={() => trocar({ auth: 'agent' })}>
                Agente SSH
              </button>
            </span>
          </div>

          {atual.auth === 'password' && (
            <div className="field">
              <span className="field__label">Senha SSH</span>
              <CampoSegredo
                valor={atual.password ?? ''}
                guardado={!!atual.hasPassword}
                onChange={(password) => trocar({ password })}
                rotulo="senha SSH"
              />
            </div>
          )}

          {atual.auth === 'key' && (
            <>
              <div className="field">
                <span className="field__label">Arquivo da chave privada</span>
                <div className="tunel__arquivo">
                  <input
                    className="input"
                    placeholder="~/.ssh/id_ed25519"
                    value={atual.privateKeyPath ?? ''}
                    onChange={(e) => trocar({ privateKeyPath: e.target.value })}
                    spellCheck={false}
                  />
                  <button type="button" className="btn btn--secondary" onClick={() => void escolherChave()}>
                    <IconFolder size={14} />
                    Escolher…
                  </button>
                </div>
              </div>
              <div className="field">
                <span className="field__label">Senha da chave (se ela tiver)</span>
                <CampoSegredo
                  valor={atual.passphrase ?? ''}
                  guardado={!!atual.hasPassphrase}
                  onChange={(passphrase) => trocar({ passphrase })}
                  rotulo="senha da chave"
                />
              </div>
            </>
          )}

          {atual.auth === 'agent' && (
            <span className="field__hint">
              Usa as chaves do agente SSH do sistema — o mesmo que o comando ssh do terminal usa,
              inclusive o do 1Password.
            </span>
          )}

          {/*
            A confusão número um de quem configura túnel: pôr no host do banco
            o endereço de fora. Dito aqui, e dito de novo pelo erro se acontecer.
          */}
          <span className="field__hint">
            Com túnel, o host e a porta do banco lá em cima são os vistos <strong>de dentro</strong> do
            servidor SSH — quase sempre localhost.
          </span>

          {atual.hostKeyFingerprint && (
            <div className="tunel__chave">
              <span>Chave do servidor guardada:</span>
              <code className="selectable">{atual.hostKeyFingerprint}</code>
              {podeEsquecerChave && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={onEsquecerChave}
                  title="Use se o servidor SSH foi reinstalado. A próxima chave que ele apresentar passa a ser a confiável."
                >
                  Esquecer
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CampoSegredo({
  valor,
  guardado,
  onChange,
  rotulo
}: {
  valor: string
  guardado: boolean
  onChange: (valor: string) => void
  rotulo: string
}): React.JSX.Element {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="campo-senha">
      <input
        className="input"
        type={visivel ? 'text' : 'password'}
        placeholder={guardado ? '••••••••  (salva)' : ''}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label={rotulo}
      />
      <button
        type="button"
        className="campo-senha__olho"
        onClick={() => setVisivel((v) => !v)}
        title={visivel ? 'Ocultar' : 'Mostrar'}
        aria-label={visivel ? `Ocultar ${rotulo}` : `Mostrar ${rotulo}`}
      >
        {visivel ? <IconViewOff size={15} /> : <IconView size={15} />}
      </button>
    </div>
  )
}
