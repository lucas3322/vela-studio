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
3. **Contraste AA nos dois temas.** Um token só existe se foi definido nos dois.

## Tokens

Todos em `src/renderer/src/styles/tokens.css`. Use sempre a custom property,
nunca o valor literal.

### Espaço
`--space-1` (4px) … `--space-10` (40px)

### Raio
`--radius-sm` 4 · `--radius-md` 6 · `--radius-lg` 10 · `--radius-xl` 14

### Tipografia
- `--font-ui` — SF Pro / system
- `--font-mono` — SF Mono / JetBrains Mono (código e **dados do grid**)
- `--text-xs` 11 · `--text-sm` 12 · `--text-base` 13 · `--text-md` 14 · `--text-lg` 16

13px é o corpo padrão. Densidade de IDE, não de site.

### Superfícies (do fundo para a frente)
`--bg-app` → `--bg-sidebar` → `--bg-surface` → `--bg-elevated`

### Texto
`--text-primary` → `--text-secondary` → `--text-tertiary`

Terciário é para metadado (tipo de coluna, contagem, timestamp). Nunca para
conteúdo que o usuário precisa ler.

### Acento
Âmbar, via `--accent-h` / `--accent-s`. Único destaque cromático da interface.
`--accent-subtle` para fundos, `--accent-text` para texto sobre superfície.

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
