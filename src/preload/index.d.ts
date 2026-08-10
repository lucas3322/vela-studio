import type { VelaApi } from '../shared/ipc'

declare global {
  interface Window {
    vela: VelaApi
    velaEvents: {
      /** Assina um evento do main. Devolve a função de cancelamento. */
      on(channel: string, listener: (...args: never[]) => void): () => void
    }
  }
}

export {}
