import { useCallback } from 'react'
import type { QueryError, QueryResult } from '@shared/types'
import { isUnboundedMutation, splitStatements } from '@shared/sql-shape'
import { useAppStore } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { classificarPasso, prepararLote } from '../editor/lote'

let queryCounter = 0

/**
 * Executa a query da aba ativa.
 *
 * Centralizado aqui porque três caminhos disparam a mesma coisa:
 * o botão, o atalho ⌘↵ e o menu nativo. Duplicar a lógica levaria a
 * comportamentos sutilmente diferentes entre eles.
 */
export function useRunQuery(): {
  run: (sqlOverride?: string, jaConfirmado?: boolean) => Promise<void>
  cancel: () => Promise<void>
} {
  const notify = useAppStore((s) => s.notify)

  const run = useCallback(
    async (sqlOverride?: string, jaConfirmado = false) => {
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

      /*
        Alteração de célula esperando confirmação, em qualquer aba.

        Executar uma consulta recarrega grades e pode remontar o resultado por
        baixo — o que faz o que a pessoa digitou desaparecer sem nunca ter ido
        ao banco. A pergunta vem antes, e ela decide: descartar e executar, ou
        voltar e terminar o que começou.
      */
      const pendentes = useAppStore.getState().totalDePendencias()
      if (pendentes > 0 && !jaConfirmado) {
        useAppStore.getState().pedirDescarteDeEdicoes(pendentes, () => {
          useAppStore.getState().descartarPendencias()
          void run(sql, true)
        })
        return
      }

      // UPDATE/DELETE sem WHERE atinge a tabela inteira e não tem desfazer.
      // A confirmação fica aqui, no caminho único de execução, para valer
      // igual pelo atalho, pelo botão e pelo menu.
      const semWhere = splitStatements(sql).filter(isUnboundedMutation)
      if (semWhere.length > 0 && !jaConfirmado) {
        useAppStore.getState().pedirConfirmacaoDeEscrita(semWhere, () => void run(sql, true))
        return
      }

      // Mais de um comando: executa um a um para poder dizer qual quebrou.
      // Com um só, o caminho antigo continua — abrir um modal de progresso
      // para uma consulta seria cerimônia sem informação.
      const comandos = splitStatements(sql)
      if (comandos.length > 1) {
        await rodarEmLote(comandos, tab.id, connectionId, activeDatabase)
        return
      }

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
          // `previewRows`, não `maxRows`: o LIMIT que o usuário escreveu tem
          // precedência. Como `maxRows`, a preferência cortava um
          // `LIMIT 50000` em 100.
          previewRows: useAppStore.getState().limitePreview
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
        const limiteAviso = useAppStore.getState().limiteAviso
        const pesado = outcome.results.find((r) => r.rowCount >= limiteAviso)
        if (pesado) {
          notify(
            `${pesado.rowCount.toLocaleString('pt-BR')} linhas. Um LIMIT menor ou filtro deixa a consulta mais rápida.`,
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

  /**
   * Executa os comandos um a um, relatando cada um.
   *
   * Para no primeiro erro e oferece continuar dali. Seguir automaticamente
   * produziria cascata: se o comando 3 cria uma tabela e o 4 insere nela,
   * os erros seguintes escondem o primeiro — o único que importa.
   *
   * O resultado que fica na aba é o do **último comando que devolveu linhas**.
   * Mostrar o do último executado deixaria a grade vazia depois de um lote que
   * termina em `UPDATE`, como se a consulta anterior não tivesse achado nada.
   */
  const rodarEmLote = useCallback(
    async (
      comandos: string[],
      tabId: string,
      connectionId: string,
      database: string | null
    ): Promise<void> => {
      const loja = useAppStore.getState()
      loja.iniciarLote(prepararLote(comandos))
      useTabStore.getState().updateTab(tabId, { running: true, error: undefined })

      let ultimoComLinhas: QueryResult[] | null = null

      const executarDe = async (inicio: number): Promise<void> => {
        for (let i = inicio; i < comandos.length; i++) {
          const passos = useAppStore.getState().lote?.passos
          if (!passos) return // a pessoa fechou o modal no meio

          useAppStore.getState().atualizarPasso(i, { sql: comandos[i], estado: 'rodando' })
          const comecou = Date.now()

          let saida: { results: QueryResult[]; error?: QueryError }
          try {
            saida = await window.vela.query.run({
              connectionId,
              sql: comandos[i],
              database: database ?? undefined,
              queryId: `lote_${Date.now()}_${i}`,
              previewRows: useAppStore.getState().limitePreview
            })
          } catch (erro) {
            saida = {
              results: [],
              error: { raw: (erro as Error).message, friendly: (erro as Error).message }
            }
          }

          const passo = classificarPasso(
            { sql: comandos[i], estado: 'rodando' },
            saida,
            Date.now() - comecou
          )
          useAppStore.getState().atualizarPasso(i, passo)

          if (passo.estado === 'erro') {
            // Para aqui. A decisão de seguir é da pessoa, com o erro na tela.
            useAppStore.getState().pararLoteNoErro(() => void executarDe(i + 1))
            useTabStore.getState().updateTab(tabId, { running: false, error: passo.erro })
            return
          }

          if (saida.results.some((r) => r.columns.length > 0)) ultimoComLinhas = saida.results
        }

        useAppStore.getState().encerrarLote()
        useTabStore.getState().updateTab(tabId, {
          running: false,
          queryId: undefined,
          results: ultimoComLinhas ?? [],
          activeResultIndex: 0
        })
      }

      await executarDe(0)
    },
    []
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
