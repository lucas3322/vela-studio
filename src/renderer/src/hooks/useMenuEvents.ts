import { useEffect } from 'react'
import { useAppStore, type ThemeMode } from '../store/app'
import { useConnectionStore } from '../store/connections'
import { useTabStore } from '../store/tabs'
import { useRunQuery } from './useRunQuery'

/**
 * Liga o menu nativo do macOS à UI.
 * O main dispara eventos; aqui traduzimos cada um em ação de store.
 */
export function useMenuEvents(): void {
  const { run, cancel } = useRunQuery()

  useEffect(() => {
    // Sempre lemos o estado na hora do evento (getState), nunca capturamos —
    // o listener vive mais que qualquer render.
    const unsubscribers = [
      window.velaEvents.on('menu:newConnection', () => useAppStore.getState().openModal('connection')),
      window.velaEvents.on('menu:newQueryTab', () => {
        const { activeId, activeDatabase } = useConnectionStore.getState()
        if (!activeId) return
        useTabStore.getState().openQueryTab({ connectionId: activeId, database: activeDatabase })
      }),
      window.velaEvents.on('menu:closeTab', () => {
        const connectionId = useConnectionStore.getState().activeId
        const tab = useTabStore.getState().activeTabFor(connectionId)
        if (tab) useTabStore.getState().closeTab(tab.id)
      }),
      window.velaEvents.on('menu:run', () => void run()),
      window.velaEvents.on('menu:runSelection', () => void run()),
      window.velaEvents.on('menu:cancel', () => void cancel()),
      window.velaEvents.on('menu:history', () => useAppStore.getState().openModal('history')),
      window.velaEvents.on('menu:cheatsheet', () => useAppStore.getState().openModal('cheatsheet')),
      window.velaEvents.on('menu:toggleSidebar', () => useAppStore.getState().toggleSidebar()),
      window.velaEvents.on('menu:toggleHelp', () => useAppStore.getState().toggleHelpPanel()),
      window.velaEvents.on('menu:theme', ((theme: ThemeMode) =>
        useAppStore.getState().setTheme(theme)) as never),
      window.velaEvents.on('app:themeChanged', ((theme: 'light' | 'dark') =>
        useAppStore.getState().applySystemTheme(theme)) as never)
    ]

    return () => unsubscribers.forEach((off) => off())
  }, [run, cancel])
}
