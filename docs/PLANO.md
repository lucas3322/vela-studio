# Vela Studio — Plano de Ação

> IDE de banco de dados (SQL + NoSQL) para macOS.
> Interface limpa, autocomplete que entende o schema, e uma camada de ajuda
> que faz a ferramenta servir tanto para quem é sênior quanto para quem está começando.

---

## 1. Posicionamento

**Problema.** Ferramentas de banco hoje se dividem em dois grupos: as poderosas e feias
(DBeaver, DataGrip) e as bonitas mas rasas (TablePlus free, Beekeeper free). Nenhuma
assume que quem escreve a query pode não saber SQL direito.

**Nossa aposta.** A IDE conhece o schema e usa esse conhecimento em três lugares:
1. **Autocomplete contextual** — sabe se você está depois de `FROM` (sugere tabelas) ou
   depois de `SELECT`/`WHERE` (sugere colunas, resolvendo aliases).
2. **Ajuda inline** — hover em qualquer palavra-chave explica o que ela faz, em português.
3. **Erros traduzidos** — `ER_NO_SUCH_TABLE` vira "A tabela `x` não existe nesse banco.
   Você quis dizer `y`?".

**Público.** Dev sênior que quer velocidade + iniciante/analista que quer aprender fazendo.
As duas coisas não conflitam: o iniciante usa o painel de ajuda, o sênior fecha o painel.

---

## 2. Escopo por fase

### Fase 1 — Fundação (MVP navegável)
- [x] Scaffold Electron + Vite + React + TypeScript
- [x] Sistema de design (tokens CSS, dark + light, troca em tempo real)
- [x] Camada de driver abstrata (`DatabaseDriver`)
- [x] Drivers: MySQL, PostgreSQL, SQLite, MongoDB
- [x] Tela de conexões (salvas + recentes), formulário por tipo de banco
- [x] Persistência de conexões com senha criptografada (`safeStorage` do Electron)

### Fase 2 — Núcleo de trabalho
- [x] Sidebar de schema (bancos → tabelas → colunas), com filtro
- [x] Editor Monaco com dialeto SQL por driver
- [x] Execução de query com atalho `⌘↵`, seleção parcial, cancelamento
- [x] Grid de resultados virtualizado (aguenta 100k+ linhas)
- [x] Abas de query e abas de tabela
- [x] Status bar: linhas, tempo, conexão ativa

### Fase 3 — A camada que diferencia
- [x] Autocomplete schema-aware com resolução de alias
- [x] Hover docs em PT-BR para keywords e funções
- [x] Tradutor de erros do banco
- [x] Snippets/receitas de query prontas
- [x] Histórico de queries executadas
- [x] Painel de estrutura da tabela (colunas, índices, relações)

### Fase 4 — Acabamento
- [ ] Export de resultado (CSV, JSON, SQL insert)
- [ ] Modo somente-leitura por conexão (trava `UPDATE`/`DELETE` sem `WHERE`)
- [ ] Editor visual de linha (edit data)
- [ ] Diagrama ERD
- [ ] Build assinado + notarizado, DMG universal (arm64 + x64)

---

## 3. Stack e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| Shell | **Electron 33** | único caminho realista para drivers nativos de banco no desktop |
| Build | **electron-vite** | HMR no renderer e no main, sem configurar webpack |
| UI | **React 18 + TypeScript** | ecossistema do Monaco, tipagem ponta a ponta |
| Editor | **Monaco** | mesma engine do VS Code; API de completion/hover é o coração do produto |
| Estado | **Zustand** | store simples, sem boilerplate de context |
| Estilo | **CSS puro + custom properties** | tema trocado por `data-theme` no `<html>`, zero runtime |
| Grid | **componente próprio virtualizado** | controle total de perf; libs genéricas travam em 100k linhas |
| Empacotamento | **electron-builder** | DMG universal, code sign, notarização |

**Drivers:** `mysql2`, `pg`, `better-sqlite3`, `mongodb`.

---

## 4. Arquitetura

```
┌─ main (Node) ────────────────────────────────┐
│  ConnectionManager  →  DriverRegistry        │
│       │                    ├─ MySQLDriver    │
│       │                    ├─ PostgresDriver │
│       │                    ├─ SQLiteDriver   │
│       │                    └─ MongoDriver    │
│  ConnectionStore (safeStorage + JSON)        │
└───────────────────┬──────────────────────────┘
                    │ IPC tipado
┌─ preload ─────────┴──────────────────────────┐
│  contextBridge → window.vela                 │
└───────────────────┬──────────────────────────┘
┌─ renderer (React) ┴──────────────────────────┐
│  App → Sidebar | TabBar | Editor | Grid      │
│  stores: connection, tabs, schema, ui        │
│  editor: completion / hover / dialects       │
└──────────────────────────────────────────────┘
```

**Regra dura:** o renderer nunca importa driver de banco. Toda query passa por IPC.
`contextIsolation: true`, `nodeIntegration: false`, sempre.

---

## 5. Contrato do driver

Todo banco — SQL ou NoSQL — implementa a mesma interface. É isso que permite a UI
tratar MongoDB e MySQL na mesma tela sem `if` espalhado.

```ts
interface DatabaseDriver {
  connect(config): Promise<void>
  disconnect(): Promise<void>
  testConnection(config): Promise<{ ok: boolean; message: string }>
  listDatabases(): Promise<string[]>
  listTables(database?): Promise<TableInfo[]>
  listColumns(table, database?): Promise<ColumnInfo[]>
  listIndexes(table, database?): Promise<IndexInfo[]>
  listRelations(table, database?): Promise<RelationInfo[]>
  query(sql, opts): Promise<QueryResult>
  cancel(queryId): Promise<void>
  readonly dialect: Dialect
}
```

Para o Mongo, "tabela" = collection, "coluna" = campo inferido por amostragem de
documentos, e `query` recebe uma expressão tipo `db.users.find({ ativo: true })`.

---

## 6. Design da interface

Referência visual: densidade do Beekeeper, respiro do Linear.

- **Cromatismo:** superfície neutra, uma única cor de acento (âmbar). Cor no dado, não na moldura.
- **Densidade:** linha de grid com 30px. Cabe informação sem virar planilha do Excel.
- **Tipografia:** UI em SF Pro (sistema), código em SF Mono / JetBrains Mono.
- **Movimento:** transições de 120ms só em hover e abertura de painel. Nada mais.
- **Tema:** `light` / `dark` / `system`, com a preferência do SO observada em tempo real.

Layout:
```
┌──────────────────────────────────────────────────────┐
│ ●●●            Vela Studio — CRM PROD                │
├────────────┬─────────────────────────────────────────┤
│ conexão ▾  │  [Query #1] [contracts] [+]             │
│ ┌────────┐ ├─────────────────────────────────────────┤
│ │ filtro │ │  SELECT * FROM contracts c              │
│ └────────┘ │  WHERE c.id IS NOT NULL                 │
│ ▸ accounts │                                         │
│ ▸ contracts├─────────────────────────────────────────┤
│ ▸ users    │  id │ vendor    │ client │ criado_em    │
│            │  262│ gabriela  │ 115    │ 2024-01-02   │
├────────────┴─────────────────────────────────────────┤
│ ● CRM PROD  mysql   10.113 linhas   1.573ms          │
└──────────────────────────────────────────────────────┘
```

---

## 7. Agentes e skills do projeto

Em `.claude/agents/` e `.claude/skills/`:

| Nome | Tipo | Função |
|---|---|---|
| `driver-engineer` | agente | Implementa e mantém drivers de banco respeitando o contrato |
| `ui-craftsman` | agente | Componentes React + CSS dentro do sistema de design |
| `editor-intelligence` | agente | Autocomplete, hover, parsing e dialetos do Monaco |
| `electron-ops` | agente | Processo main, IPC, segurança, build e empacotamento |
| `vela-design-system` | skill | Tokens, regras de espaçamento, cor e tipografia |
| `vela-driver-contract` | skill | Contrato do driver + checklist para adicionar um banco novo |
| `vela-ipc` | skill | Como criar um canal IPC novo ponta a ponta com tipo |

---

## 8. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `better-sqlite3` é módulo nativo, quebra em upgrade do Electron | `electron-builder install-app-deps` no postinstall |
| Query de 1M de linhas trava o renderer | `LIMIT` implícito de 50k + streaming por página |
| Senha em disco | `safeStorage` (Keychain do macOS); nunca em texto puro |
| Notarização exige conta Apple Developer | build local não assinado até ter a conta |
