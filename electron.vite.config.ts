import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }

/**
 * Commit exato do build.
 *
 * Sem isso, "estou na 0.2.1" não diz se a pessoa tem a correção de ontem.
 * Um build fora de repositório git (tarball, CI sem histórico) não é erro —
 * cai para 'desconhecido' e segue.
 */
function gitSha(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    // O sufixo avisa que o build tem alterações não commitadas.
    return dirty ? `${sha}+alterado` : sha
  } catch {
    return 'desconhecido'
  }
}

const buildInfo = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __GIT_SHA__: JSON.stringify(gitSha()),
  __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
}

export default defineConfig({
  main: {
    define: buildInfo,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    define: buildInfo,
    root: resolve('src/renderer'),
    /*
     * Porta fixa e endereço explícito, os dois de propósito.
     *
     * O padrão do Vite escuta em `localhost`, que resolve para `::1`, enquanto
     * um `python3 -m http.server --bind 127.0.0.1` na mesma porta escuta em
     * IPv4. As duas famílias de endereço convivem: **nenhum dos dois acusa
     * porta ocupada**. Aí o Electron pede `http://localhost:5173`, o
     * resolvedor escolhe o IPv4, e a janela do Vela abre o app do vizinho —
     * sem um único erro no console. Aconteceu de verdade.
     *
     * Fixando o endereço em IPv4, a colisão vira falha de bind; com
     * `strictPort`, essa falha derruba o `npm run dev` com mensagem clara em
     * vez de escolher outra porta e deixar o Electron apontado para a errada.
     */
    server: {
      host: '127.0.0.1',
      strictPort: true
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
        output: {
          // Monaco em chunk próprio: muda pouco, então seu cache sobrevive
          // aos builds do código da aplicação.
          manualChunks(id: string) {
            return id.includes('monaco-editor') ? 'monaco' : undefined
          }
        }
      }
    },
    plugins: [react()]
  }
})
