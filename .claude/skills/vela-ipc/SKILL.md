---
name: vela-ipc
description: Como criar um canal IPC novo no Vela Studio ponta a ponta, com tipagem e sem furar a fronteira de segurança do Electron. Use ao expor qualquer capacidade nova do processo main para o renderer.
---

# Criando um canal IPC

O renderer não tem acesso a Node. Toda capacidade nova atravessa quatro
arquivos, sempre nesta ordem — pular etapa gera erro de tipo, que é o objetivo.

## Os quatro passos

### 1. O tipo — `src/shared/types.ts`

Se o canal transporta uma estrutura nova, ela nasce aqui. Regra: **se atravessa
o IPC, o tipo mora em `shared/`**.

```ts
export interface ExplainPlan {
  steps: Array<{ operation: string; cost: number; rows: number }>
  totalCost: number
}
```

### 2. Nome e assinatura — `src/shared/ipc.ts`

```ts
export const IPC = {
  // …
  queryExplain: 'query:explain'
} as const

export interface VelaApi {
  query: {
    // …
    explain(connectionId: string, sql: string): Promise<ExplainPlan>
  }
}
```

Declarar em `VelaApi` sem implementar no preload quebra o typecheck. É de
propósito.

### 3. O handler — `src/main/ipc-handlers.ts`

```ts
ipcMain.handle(IPC.queryExplain, (_e, connectionId: string, sql: string) =>
  manager.get(connectionId).driver.explain(sql)
)
```

`manager.get()` lança erro claro se a conexão não estiver aberta — deixe
lançar, o renderer trata.

### 4. A ponte — `src/preload/index.ts`

```ts
query: {
  // …
  explain: (connectionId, sql) => ipcRenderer.invoke(IPC.queryExplain, connectionId, sql)
}
```

## Uso no renderer

```ts
const plan = await window.vela.query.explain(connectionId, sql)
```

## Regras que não se quebram

**Nunca exponha `ipcRenderer` cru.** Cada método é uma porta específica. Um
canal genérico (`invoke(comando, args)`) reabre exatamente o que o
`contextIsolation` fechou.

**Nunca importe `electron` ou `node:` no renderer.** Se você precisa de algo do
sistema, o caminho é um canal novo — não uma exceção.

**Tudo precisa sobreviver ao structured clone.** `Date` → ISO string,
`BigInt` → string, `Buffer` → resumo hex, `ObjectId` → string. Use
`serializeValue()` de `src/main/drivers/value-types.ts`.

**Erro de driver é traduzido antes de subir.** Passe por `translateError()`
com o contexto de schema — é o que transforma `ER_BAD_FIELD_ERROR` em "a
coluna `nomee` não existe, você quis dizer `nome`?".

## Eventos do main para o renderer

Sentido oposto (menu nativo, mudança de tema do SO): `webContents.send` no main,
`window.velaEvents.on` no renderer. O preload só aceita canais com prefixo
`menu:` ou `app:` — uma allowlist, não um filtro genérico.

```ts
// main
window.webContents.send('menu:run')

// renderer
useEffect(() => window.velaEvents.on('menu:run', () => void run()), [run])
```

`velaEvents.on` devolve a função de cancelamento; use-a no cleanup do effect.

## Verificação

```bash
npm run typecheck
```

Se o canal está em `VelaApi` mas falta no preload, ou o handler não bate com a
assinatura, o typecheck acusa antes de você abrir o app.
