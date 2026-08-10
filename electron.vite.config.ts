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
