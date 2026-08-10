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

## Publicando no Railway

O `Dockerfile` daqui sobe um Caddy servindo os estáticos.

**Atenção ao contexto do build.** Os `COPY` partem da **raiz do repositório**,
não desta pasta — é assim que o Railway constrói quando se aponta o
"Dockerfile Path" para `/landing/Dockerfile` sem definir o "Root Directory".
Com `COPY Caddyfile` (sem prefixo) o build falha com `"/Caddyfile": not found`.

Configuração do serviço:

| Campo | Valor |
|---|---|
| Builder | Dockerfile |
| Dockerfile Path | `/landing/Dockerfile` |
| Root Directory | *(vazio)* |
| Watch Paths | `/landing/**` |
| Variables | `PORT=8080` |

O `PORT` não é estritamente necessário — o Caddyfile usa `{$PORT:8080}` e cai
no 8080 quando a variável não existe — mas defini-lo elimina a dúvida, que é a
causa mais comum de `502 Application failed to respond` depois de um build bem
sucedido.

### Quando der 502

**Causa nº 1, já vista neste projeto: porta.** O Railway escolhe uma porta ao
criar o domínio — se o primeiro deploy falhou no build, ele chuta (aconteceu:
ficou em 3001) e não corrige sozinho depois. O Caddy escuta na 8080.

Networking → lápis ao lado do domínio → **Port: 8080**. Ou, equivalente,
Variables → `PORT=3001`, que faz o Caddy seguir o que o Railway espera.

Se não for isso, nessa ordem:

1. **Deployments → último deploy → Build Logs.** Se o build falhou, não há
   container rodando. O erro aparece aqui.
2. **Deploy Logs.** O Caddy loga `server running` com o endereço em que
   escutou. Se não aparecer, ele nem subiu.
3. **Networking → Target Port.** Precisa bater com a porta do log (8080).

Para reproduzir localmente exatamente como o Railway faz — contexto na raiz:

```bash
docker build -f landing/Dockerfile -t vela-landing .
docker run --rm -e PORT=8080 -p 8080:8080 vela-landing
```

## Outros hosts

Como é HTML estático, qualquer host serve sem o Docker:

- **Vercel / Netlify / Cloudflare Pages** — sem comando de build; diretório `landing`
- **GitHub Pages** — publique a pasta `landing`

## Detalhes que importam

**Detecção de sistema.** A página destaca o download certo para quem chega.
Apple Silicon não é detectável de forma confiável — os navegadores no macOS
reportam "Intel Mac OS X" mesmo em M1/M2/M3 por compatibilidade, e a única
pista prática é o renderizador do WebGL. Por isso a interface apenas *sugere*
uma opção e nunca esconde a outra.

**Fontes.** Instrument Serif, IBM Plex Sans e IBM Plex Mono, via Google Fonts.
Para hospedar sem depender de CDN, baixe os arquivos e troque o `<link>`.
