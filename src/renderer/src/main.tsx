import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

/*
 * No macOS a janela nasce com vibrancy e fundo transparente (ver
 * `src/main/index.ts`); o atributo libera a barra lateral para deixar o
 * material aparecer. Nos outros sistemas não existe material por trás, e o
 * fundo transparente viraria preto.
 */
if (window.vela.app.platform === 'darwin') document.documentElement.dataset.vibrancy = 'on'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
