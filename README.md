<div align="center">

# Vela Studio

**Uma IDE de banco de dados que ajuda você a escrever a query — não só a executá-la.**

MySQL · PostgreSQL · SQLite · MongoDB · macOS

</div>

---

## Por que existe

Ferramentas de banco se dividem em dois grupos: as poderosas e feias, e as
bonitas e rasas. Nenhuma assume que quem escreve a query pode não saber SQL
direito.

O Vela conhece o schema do seu banco e usa esse conhecimento em três lugares:

**Autocomplete que entende contexto.** Depois de `FROM`, sugere tabelas. Depois
de `SELECT` ou `WHERE`, sugere colunas — resolvendo apelidos, então `c.` já
oferece as colunas de `contracts`.

**Ajuda inline em português.** Passe o mouse em qualquer palavra-chave e leia o
que ela faz, com exemplo e a pegadinha típica. `LEFT JOIN` avisa que filtrar a
tabela da direita no `WHERE` transforma tudo em `INNER JOIN` sem avisar.

**Erros traduzidos.** `ER_BAD_FIELD_ERROR` vira "a coluna `nomee` não existe.
Você quis dizer `nome`?".

## O que tem

- **Quatro bancos**, relacionais e de documentos, sob a mesma interface
- **Editor Monaco** com dialeto por banco, formatação em `⌘⇧F` e execução em `⌘↵`
- **Grid virtualizado** que aguenta 50.000 linhas sem travar, com cor por tipo
  de dado e redimensionamento de coluna
- **Navegador de schema** com filtro que busca também dentro dos nomes de coluna
- **Receitas prontas** — 25 padrões de query com a sua tabela já preenchida
- **Guia rápido** de SQL e MongoDB, navegável e buscável
- **Histórico** das últimas 500 queries, com busca
- **Modo somente-leitura** por conexão, que bloqueia escrita no driver
- **Temas claro e escuro**, desenhados separadamente, seguindo o macOS
- **Senhas no Keychain** via `safeStorage` — nunca em texto no disco

## Começando

```bash
npm install
npm run dev
```

Gerar o app para macOS:

```bash
npm run mac
```

O DMG universal (Apple Silicon + Intel) sai em `release/`.

> Sem uma conta Apple Developer o build não é assinado nem notarizado: o app
> funciona, mas o Gatekeeper avisa na primeira abertura. Botão direito → Abrir.

## Atalhos

| | |
|---|---|
| `⌘↵` | Executar |
| `⌘⇧↵` | Executar só a seleção |
| `⌘.` | Cancelar execução |
| `⌘⇧F` | Formatar SQL |
| `⌘T` | Nova aba de query |
| `⌘B` | Barra lateral |
| `⌘J` | Painel de receitas |
| `⌘⇧H` | Histórico |
| `⌘⇧N` | Nova conexão |

## Stack

Electron 33 · React 18 · TypeScript · Monaco · Zustand · electron-vite

Drivers: `mysql2`, `pg`, `better-sqlite3`, `mongodb`.

## Segurança

O renderer roda com `contextIsolation: true` e `nodeIntegration: false`. A única
ponte é o preload, que expõe métodos nomeados — nunca o `ipcRenderer` cru. CSP
restritiva, sem requisição externa, link externo desviado para o navegador do
sistema.

## Documentação

- [`docs/PLANO.md`](docs/PLANO.md) — plano de ação, decisões de stack e roadmap
- [`CLAUDE.md`](CLAUDE.md) — mapa do código e convenções
- `.claude/skills/` — contrato do driver, sistema de design, guia de IPC

## Licença

MIT
