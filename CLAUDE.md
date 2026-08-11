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
8. **Instalador de outra arquitetura instala e depois falha.** Um DMG arm64 com
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
