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
- **Senhas cifradas em disco** (AES-256-GCM, chave em arquivo 0600) — nunca em texto

## Começando

```bash
npm install
npm run dev
```

## Versionamento

Um comando faz tudo: lê os commits desde a última tag, decide o salto, escreve
a versão, gera o CHANGELOG, commita, cria a tag e dá push.

```bash
npm run release
```

O salto sai dos commits, se eles seguirem Conventional Commits:

| Commit | Salto |
|---|---|
| `feat!:` ou `BREAKING CHANGE:` no corpo | **major** — 1.4.2 → 2.0.0 |
| `feat:` | **minor** — 1.4.2 → 1.5.0 |
| `fix:`, `refactor:`, qualquer outro | **patch** — 1.4.2 → 1.4.3 |

Se os commits não seguem a convenção, ele avisa e usa patch. Nesse caso diga o
salto na mão — o argumento explícito sempre vence:

```bash
npm run release minor
```

Antes de confiar, veja o que ele faria:

```bash
npm run release:dry
```

A tag `vX.Y.Z` dispara o workflow, que compila nos três sistemas e publica uma
GitHub Release com os instaladores e as notas do CHANGELOG.

**Versão dentro do app.** `__APP_VERSION__`, `__GIT_SHA__` e `__BUILD_DATE__`
são substituídos em tempo de build e aparecem no menu *Sobre* e na tela inicial.
O commit vai junto de propósito: saber que alguém está na 0.2.1 não diz se a
correção de ontem entrou; o hash diz. Um build com alterações não commitadas sai
marcado como `abc1234+alterado`.

## Gerando os instaladores

```bash
npm run mac      # DMG + ZIP  (arm64 e x64)
npm run win      # instalador .exe + portátil .exe  (x64)
npm run linux    # AppImage + .deb
npm run dist     # macOS e Windows de uma vez
```

Tudo sai em `release/`. Para regerar os ícones a partir de `build/icon.svg`:

```bash
npm run icons
```

**Sobre o build de Windows feito no Mac.** Ele funciona — o electron-builder
baixa o próprio wine e o NSIS. Mas há uma armadilha: `@electron/rebuild` não faz
compilação cruzada, então o `better-sqlite3` que iria dentro do `.exe` seria o
binário do macOS. O instalador sairia sem erro nenhum e o app abriria; só o
SQLite quebraria, na primeira conexão. O hook `scripts/after-pack.mjs` corrige
isso trocando pelo binário oficial pré-compilado do Windows — e **aborta o
build** se não conseguir, porque um instalador silenciosamente quebrado é pior
que build nenhum.

Para builds de release, prefira o CI (`.github/workflows/build.yml`): cada
sistema compila nativamente e nada depende de prebuild publicado.

**Assinatura.** Sem conta Apple Developer o `.app` recebe assinatura ad-hoc e
não é notarizado. Ele funciona, mas o Gatekeeper barra a primeira abertura com
"a Apple não pôde verificar se o item está livre de malware".

A saída **não** é mais clicar com o botão direito → Abrir: a Apple removeu esse
atalho no macOS 15. O caminho atual é tentar abrir uma vez e depois autorizar em
*Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim*. Pelo
terminal, `xattr -d com.apple.quarantine "/Applications/Vela Studio.app"` remove
a marca de quarentena e resolve de uma vez.

Isso é distinto de "o app está danificado", que era um **bug de build** (binário
de outra arquitetura dentro do pacote) e já foi corrigido. Se essa mensagem
voltar, o problema é o pacote, não o Gatekeeper — confira com
`codesign --verify --strict` e `file Contents/MacOS/"Vela Studio"`.

No Windows, sem certificado de code signing o SmartScreen mostra o aviso de
editor desconhecido.

## Atalhos

| | |
|---|---|
| `⌘↵` | Executar **a seleção**; sem seleção, o statement sob o cursor |
| `⌘⇧↵` | Executar a aba inteira |
| `⌘.` | Cancelar execução |
| `⌘S` | Salvar a query da aba |
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
