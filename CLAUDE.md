# Vela Studio

IDE de banco de dados (SQL + NoSQL) para macOS. Electron + React + TypeScript.

**A tese do produto:** a IDE conhece o schema e usa isso em três lugares —
autocomplete contextual, ajuda inline em português e erros traduzidos. Serve
tanto ao dev sênior que quer velocidade quanto a quem está aprendendo SQL.

## Comandos

```bash
npm run dev        # app em modo desenvolvimento, com HMR
npm test           # testes da lógica pura (node:test)
npm run typecheck  # valida main + preload e renderer
npm run build      # typecheck + compila para out/
npm run mac        # gera o DMG universal em release/
```

Testes de driver contra bancos reais, em containers descartáveis:

```bash
docker compose -f src/tests/docker-compose.yml up -d --wait
npm run test:db    # mysql + postgres + mongo + sqlite
```

Cada driver também roda isolado: `test:mysql`, `test:postgres`, `test:mongo`,
`test:sqlite`. O de SQLite recompila o módulo nativo para o ABI do Node e
devolve para o Electron ao final — não interrompa no meio.

## Arquitetura

```
src/
├── shared/       tipos e nomes de canal IPC — a fronteira contratual
├── main/         Node: drivers, conexões, persistência, menu
│   └── drivers/  um arquivo por banco, todos sob a mesma interface
├── preload/      contextBridge → window.vela
└── renderer/     React
    └── src/
        ├── editor/      autocomplete, hover, docs PT-BR, formatador, receitas
        ├── model/       grafo do schema e layout do diagrama de modelagem
        ├── components/  UI
        ├── store/       Zustand
        └── styles/      tokens.css é a fonte da verdade visual
```

**Regra dura:** o renderer nunca importa driver nem nada de `node:`. Toda query
passa por IPC. `contextIsolation: true`, `nodeIntegration: false`, sempre.

## Onde mexer

| Tarefa | Comece por | Skill |
|---|---|---|
| Banco novo ou bug de driver | `src/main/drivers/` | `vela-driver-contract` |
| Autocomplete, hover, docs | `src/renderer/src/editor/` | — |
| Componente, tema, layout | `src/renderer/src/components/`, `styles/` | `vela-design-system` |
| Expor capacidade nova ao renderer | `src/shared/ipc.ts` | `vela-ipc` |

Agentes especializados em `.claude/agents/`: `driver-engineer`,
`editor-intelligence`, `ui-craftsman`, `electron-ops`.

## Convenções

- Comentários e textos de UI em **português**. Código em inglês.
- Nada de valor mágico em CSS — tudo vem de custom property em `tokens.css`.
- Zustand sempre com seletor: `useStore((s) => s.campo)`.
- Lista longa é virtualizada. O grid aguenta 50.000 linhas.
- Estado que sobrevive à troca de aba mora no store, não em `useState`.
- A CI roda macOS, Windows e Linux. Asserção sobre caminho usa `join`,
  `dirname` e `basename` — nunca separador escrito à mão. Um `'/tmp/x.csv'`
  literal passa aqui e reprova só no Windows, onde `path.join` devolve `\`.
- Módulo do renderer que tem teste importa irmão **com a extensão `.ts`**. O
  `node --experimental-strip-types` não resolve sem ela, e o `tsc` só aceita
  por causa do `allowImportingTsExtensions` em `tsconfig.web.json`.

## Armadilhas já pagas

Todas encontradas rodando contra bancos reais, nenhuma pegável por typecheck.
Cada uma tem teste que a trava.

1. **`information_schema` muda de caixa entre versões do MySQL.** No 8 devolve
   `TABLE_NAME`; no 5.7, `table_name`. Ler `row.table_name` não dá erro — dá
   `undefined`, e a barra lateral lista 209 tabelas sem nome. **Toda consulta de
   catálogo usa alias explícito.**
2. **Formato de objeto colapsa colunas homônimas.** `SELECT c.id, p.id` de um
   JOIN vira uma coluna só, sem aviso. Os três drivers SQL leem linha como
   array (`rowsAsArray`, `rowMode: 'array'`, `.raw()`) e montam o grid por
   posição, via `toGridFromArrays`.
3. **`vm.runInNewContext` quebra o BSON.** Objetos criados em outro realm falham
   em `instanceof RegExp`/`Date`, e o filtro do Mongo era descartado em silêncio.
   O parser roda no realm do processo, com globais perigosos sombreados.
4. **Aspas duplas em SQL são identificador, não string.** Mascarar `"..."` como
   literal fazia `FROM "minha tabela"` ser lido como tabela `minha`.
5. **`array_agg` sobre coluna `name` volta como texto cru.** O `pg` não tem
   parser para `name[]`; o cast `::text` resolve.
6. **Monaco completo custa 6 MB e ~90 gramáticas.** Importamos `editor.api`
   mais as contribuições necessárias, e só SQL + JavaScript.
7. **Ordenar no cliente responde outra pergunta.** A aba de tabela carrega 500
   linhas; ordenar esse recorte no navegador entrega "o maior valor entre as
   500 primeiras" quando perguntaram "o maior valor da tabela" — e a tela fica
   idêntica nos dois casos. O clique no cabeçalho **reexecuta a query** com
   `ORDER BY`, e o `LIMIT` vem depois, para o corte cair sobre a tabela já
   ordenada.
8. **No tema claro, `--bg-app`, `--bg-surface` e `--bg-elevated` são todos
   brancos.** A elevação ali é feita por sombra, não por cor de superfície.
   Quem desenha um objeto flutuante com `fill: var(--bg-surface)` e
   `stroke: var(--border-default)` produz cartão branco sobre fundo branco com
   contorno de 1.28:1 — invisível. Objeto grande cuja superfície tem a cor do fundo usa
   `--contorno-objeto` (3.10:1 nos dois temas) — o cartão da modelagem e a
   área de edição de célula —, pelo mesmo motivo que o `--grid-line` existe
   separado do `--border-subtle`.
9. **Chave estrangeira declarada é minoria em banco real.** Muito sistema
   legado mantém a integridade na aplicação. Ler só o catálogo faz a
   modelagem abrir vazia — o que não é neutro, é uma afirmação falsa sobre o
   schema. Por isso existe a inferência por nome de coluna, sempre desenhada
   tracejada e rotulada como provável. **Palpite nunca se veste de fato.**
10. **Instalador de outra arquitetura instala e depois falha.** Um DMG arm64 com
   binário x86_64 dentro abre como "app danificado". O `escolherAsset` do
   atualizador não tem fallback: sem o arquivo da arquitetura exata, ele
   devolve nada e a UI manda o usuário para a página da release.

O padrão comum: **falha silenciosa**. Toda mudança em driver ou em leitura de
schema precisa de teste contra banco real — o typecheck não vê nenhuma delas.

## Verificação antes de fechar qualquer tarefa

```bash
npm run typecheck && npm test
```

Se mexeu em UI, abra o app e confira nos **dois temas**.
