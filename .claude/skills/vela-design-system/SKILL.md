---
name: vela-design-system
description: Sistema de design do Vela Studio — tokens de cor, espaçamento, tipografia, temas claro e escuro, e as regras de composição de componentes. Use ao criar ou alterar qualquer coisa visual em src/renderer/src/components/ ou src/renderer/src/styles/.
---

# Sistema de design do Vela Studio

Referência: densidade do Beekeeper Studio, respiro do Linear. Uma IDE de banco
é usada oito horas por dia — cada pixel de ruído vira cansaço acumulado.

## As três regras

1. **Superfície neutra.** Cor aparece no dado e no acento, nunca na moldura.
2. **Espaçamento em múltiplos de 4.** Não existe `13px` neste projeto.
3. **Contraste AA nos dois temas.** Um token só existe se foi definido nos dois,
   e "definido" inclui **medido**: texto precisa de 4.5:1 contra a superfície
   onde vive, elemento de interface precisa de 3:1. Já tivemos `--data-null` a
   2.19:1 no claro e 2.92:1 no escuro — o `NULL` aparecia em quase toda linha
   e ninguém conseguia lê-lo. Ao mexer numa cor, calcule a razão.

## Tokens

Todos em `src/renderer/src/styles/tokens.css`. Use sempre a custom property,
nunca o valor literal.

### Espaço
`--space-1` (4px) … `--space-10` (40px)

### Raio
`--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 10 · `--radius-xl` 14

### Tipografia
- `--font-ui` — SF Pro / system
- `--font-mono` — SF Mono / JetBrains Mono (código e dados que **alinham**:
  número, data, booleano, NULL)
- `--text-xs` 11 · `--text-sm` 12 · `--text-base` 13 · `--text-md` 14 · `--text-lg` 16

13px é o corpo padrão. Densidade de IDE, não de site.

**No grid, a fonte depende do que a coluna carrega.** Monoespaçada é a base,
porque número e data precisam alinhar por coluna. Texto corrido (`string`,
`json`) usa `--font-ui`: um nome de empresa em mono ocupa ~15% mais largura e
obriga a soletrar em vez de reconhecer a palavra.

### Superfícies (do fundo para a frente)
`--bg-app` → `--bg-sidebar` → `--bg-surface` → `--bg-elevated`

### Texto
`--text-primary` → `--text-secondary` → `--text-tertiary`

Terciário é para metadado (tipo de coluna, contagem, timestamp). Nunca para
conteúdo que o usuário precisa ler.

### Acento
Âmbar, via `--accent-h` / `--accent-s`. Único destaque cromático da interface.

| Token | Para quê | Mínimo |
|---|---|---|
| `--accent` | preenchimento e elemento de interface (barra ativa, ícone, borda) | 3:1 |
| `--accent-text` | acento **como texto** sobre superfície | 4.5:1 |
| `--accent-subtle` | fundo tênue | — |
| `--accent-ink` | tinta que vai **por cima** do `--accent` | 4.5:1 |

**`--accent-ink` existe porque `--text-inverse` não serve aqui.** O inverso do
tema claro é branco, e branco sobre âmbar dá 2.87:1 — o botão primário do app
ficou meses quase ilegível no tema claro por causa disso. Âmbar é uma cor
clara nos dois temas, então a tinta em cima dele é escura nos dois.

### Linhas do grid

`--grid-line` é a malha do grid, separada de `--border-subtle` de propósito: a
borda sutil separa painéis grandes, e a malha desenha milhares de células. Com
o valor da borda sutil ela media **1.17:1** contra o fundo — abaixo do limiar
de percepção, e o grid lia como texto solto em vez de tabela. Hoje está em
1.47:1 no escuro e 1.38:1 no claro.

### Cores de dado (só no grid)
`--data-number` · `--data-string` · `--data-date` · `--data-boolean` ·
`--data-null` · `--data-json`

Aqui a cor carrega informação: você bate o olho e sabe que a coluna é numérica.
Número também alinha à direita e usa `font-variant-numeric: tabular-nums`.

### Movimento
`--duration-fast` 120ms · `--duration-base` 180ms · `--ease`

Só hover e abertura de painel animam. `prefers-reduced-motion` já está
tratado globalmente.

## Dimensões estruturais

```
--titlebar-height   38px
--statusbar-height  28px
--tabbar-height     36px
--row-height        30px   ← densidade do grid
```

## Como os temas funcionam

`document.documentElement.dataset.theme = 'dark' | 'light'`. As custom
properties observam esse atributo; nenhum componente lê o tema em JS para
decidir cor.

O tema claro **não é o escuro invertido**: contraste, sombras e cores de dado
são recalculados. Ao adicionar um token, defina nos dois blocos.

## Primitivos prontos

Antes de escrever CSS novo, veja se já existe em `global.css`:

`.btn` (+ `--primary` `--secondary` `--ghost` `--danger` `--sm`) ·
`.input` · `.field` + `.field__label` + `.field__hint` · `.badge` ·
`.icon-btn` · `.spinner` · `.checkbox` · `.segmented` · `.data-table` ·
`.modal` + `.modal__header/body/footer` · `.divider`

Layout e componentes específicos ficam em `layout.css`, nomeados por bloco
(`.sidebar__connection`, `.grid__cell--number`).

## Ícones

`components/Icons.tsx`, grade de 16px, traço 1.5, `currentColor`. Inline em
vez de biblioteca: são poucos e assim herdam cor sem 400 kB de bundle.

## Checklist antes de terminar

- [ ] Nenhum valor mágico — tudo via token
- [ ] Verificado no tema claro **e** no escuro
- [ ] Botão só de ícone tem `title`
- [ ] Foco visível preservado
- [ ] Texto de UI não selecionável; dado usa `.selectable`
- [ ] Se é lista longa, está virtualizada
