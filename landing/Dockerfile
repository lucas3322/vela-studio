# Landing page do Vela Studio — HTML estático servido pelo Caddy.
#
# No Railway: crie o serviço apontando para este repositório e defina
# Settings → Root Directory = `landing`. O Dockerfile é detectado sozinho.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html icon.svg /srv/

# Falha o build se o Caddyfile tiver erro de sintaxe, em vez de subir quebrado.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
