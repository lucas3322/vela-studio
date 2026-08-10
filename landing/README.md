# Landing page do Vela Studio

Página estática, um arquivo só. Sem build, sem dependências, sem framework —
sobe em qualquer lugar arrastando a pasta.

## Antes de publicar

Abra `index.html` e ajuste a constante no topo do `<script>`:

```js
const REPO = 'lucas3322/vela-studio';
```

É de lá que saem os links de download e do código. A página consulta a API do
GitHub para descobrir a última release e montar os links diretos com o tamanho
de cada arquivo. Se a consulta falhar — repositório privado, limite de
requisições, sem internet — os botões continuam levando à página de versões,
que sempre funciona.

## Publicando

Qualquer host de estáticos serve. Aponte o diretório de saída para `landing/`:

- **Vercel / Netlify / Cloudflare Pages** — sem comando de build; diretório `landing`
- **Railway** — serviço estático apontando para `landing`
- **GitHub Pages** — publique a pasta `landing` no branch `gh-pages`

## Detalhes que importam

**Detecção de sistema.** A página destaca o download certo para quem chega.
Apple Silicon não é detectável de forma confiável — os navegadores no macOS
reportam "Intel Mac OS X" mesmo em M1/M2/M3 por compatibilidade, e a única
pista prática é o renderizador do WebGL. Por isso a interface apenas *sugere*
uma opção e nunca esconde a outra.

**Fontes.** Instrument Serif, IBM Plex Sans e IBM Plex Mono, via Google Fonts.
Para hospedar sem depender de CDN, baixe os arquivos e troque o `<link>`.
