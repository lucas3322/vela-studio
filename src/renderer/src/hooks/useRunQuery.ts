import { useCallback } from 'react'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'

let queryCounter = 0

/**
 * Executa a query da aba ativa.
 *
 * Centralizado aqui porque três caminhos disparam a mesma coisa:
 * o botão, o atalho ⌘↵ e o menu nativo. Duplicar a lógica levaria a
 * comportamentos sutilmente diferentes entre eles.
 */
export function useRunQuery(): {
  run: (sqlOverride?: string) => Promise<void>
  cancel: () => Promise<void>
} {
  const notify = useAppStore((s) => s.notify)

  const run = useCallback(
    async (sqlOverride?: string) => {
      const { activeId: connectionId, activeDatabase } = useConnectionStore.getState()
      if (!connectionId) {
        notify('Conecte-se a um banco antes de executar.', 'danger')
        return
      }

      const tabStore = useTabStore.getState()
      const tab = tabStore.activeTabFor(connectionId)
      if (!tab) return

      const sql = (sqlOverride ?? tab.sql).trim()
      if (!sql) return
      if (tab.running) return

      const queryId = `q_${Date.now()}_${++queryCounter}`
      // `connectionId` não entra no patch: a conexão da aba é imutável.
      tabStore.updateTab(tab.id, {
        running: true,
        queryId,
        error: undefined,
        database: activeDatabase
      })

      try {
        const outcome = await window.vela.query.run({
          connectionId,
          sql,
          database: activeDatabase ?? undefined,
          queryId,
          // Só vale para query sem LIMIT declarado: o driver respeita o LIMIT
          // do usuário quando ele existe, e este teto é o corte de segurança.
          maxRows: useAppStore.getState().limitePreview
        })

        useTabStore.getState().updateTab(tab.id, {
          running: false,
          queryId: undefined,
          results: outcome.results,
          activeResultIndex: 0,
          error: outcome.error
        })

        // O corte já é informado na própria grade, embaixo do resultado. Um
        // toast a cada execução repetia a mesma coisa em cima disso, e some
        // sozinho antes de a pessoa terminar de ler — só entra quando o
        // volume passa do limite e vira conselho de desempenho.
        const cortado = outcome.results.find((r) => r.truncatedAt)
        const limiteAviso = useAppStore.getState().limiteAviso
        if (cortado?.truncatedAt && cortado.truncatedAt >= limiteAviso) {
          notify(
            `${cortado.truncatedAt.toLocaleString('pt-BR')} linhas. Um LIMIT ou filtro deixa a consulta mais rápida.`,
            'info'
          )
        }
      } catch (error) {
        useTabStore.getState().updateTab(tab.id, {
          running: false,
          queryId: undefined,
          error: {
            raw: (error as Error).message,
            friendly: (error as Error).message
          }
        })
      }
    },
    [notify]
  )

  const cancel = useCallback(async () => {
    const connectionId = useConnectionStore.getState().activeId
    const tab = useTabStore.getState().activeTabFor(connectionId)
    if (!tab?.queryId || !connectionId) return

    await window.vela.query.cancel(connectionId, tab.queryId).catch(() => undefined)
    useTabStore.getState().updateTab(tab.id, { running: false, queryId: undefined })
    notify('Execução cancelada.', 'info')
  }, [notify])

  return { run, cancel }
}
