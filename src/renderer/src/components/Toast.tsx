import { useAppStore } from '../store/app'
import { IconCheck, IconWarning } from './Icons'

export function Toast(): React.JSX.Element | null {
  const toast = useAppStore((s) => s.toast)
  if (!toast) return null

  return (
    <div className={`toast toast--${toast.tone}`} role="status">
      {toast.tone === 'success' && <IconCheck style={{ color: 'var(--success)' }} />}
      {toast.tone === 'danger' && <IconWarning style={{ color: 'var(--danger)' }} />}
      <span>{toast.message}</span>
    </div>
  )
}
