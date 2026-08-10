# Landing page do Vela Studio — HTML estático servido pelo Caddy.
#
# ATENÇÃO AO CONTEXTO: os caminhos abaixo partem da **raiz do repositório**,
# não da pasta `landing/`. É assim que o Railway constrói quando se aponta
# "Dockerfile Path" para /landing/Dockerfile sem definir "Root Directory".
# Se um dia o Root Directory for definido como `landing`, estes COPY precisam
# perder o prefixo.
FROM caddy:2-alpine

COPY landing/Caddyfile /etc/caddy/Caddyfile
COPY landing/index.html landing/icon.svg /srv/

# Falha o build se o Caddyfile tiver erro de sintaxe, em vez de subir quebrado.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
