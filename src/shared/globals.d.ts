/**
 * Constantes trocadas em tempo de build pelo `define` do electron.vite.config.ts.
 * Declaradas aqui porque `src/shared` entra nos dois projetos do TypeScript,
 * então main, preload e renderer enxergam as mesmas.
 */
declare const __APP_VERSION__: string
declare const __GIT_SHA__: string
declare const __BUILD_DATE__: string
