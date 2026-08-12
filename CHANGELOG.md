# Changelog

Todas as mudanças relevantes do Vela Studio.
Gerado por `npm run release` a partir dos commits.

## 0.14.0 — 2026-08-12

### Novidades

- atualizar configuração do build para usar windows-2022 devido a problemas de compatibilidade com node-gyp (b9cd243)

## 0.13.0 — 2026-08-12

### Novidades

- implementar barra de filtro rápido com suporte a SQL e MongoDB (6fb9ffd)
- melhorar a experiência de carregamento da grade e preservar a rolagem horizontal (d43a81a)
- implementar componente ConnectionRow e refatorar modal de conexão para uso de ações no hover (b51804b)

## 0.12.0 — 2026-08-12

### Novidades

- adicionar aviso de corte de resultados e configuração de limite de desempenho (aa15f03)

## 0.11.0 — 2026-08-12

### Novidades

- Adicionando aba de configuração na IDE (b28769a)

### Outras mudanças

- ajustes no espaçamento da landing page (6071f7f)

## 0.10.0 — 2026-08-12

### Novidades

- adicionar seleção de linha e copiar conteúdo da célula na grade (851af49)
- adicionar ícone de código e ajustar exibição de abas no Workspace (8fae1ad)
- ajustar cores e estilos dos botões e abas para melhor legibilidade (c8a023d)
- atualizar diretrizes de contraste e acentos no sistema de design (019fdbf)
- adicionar funcionalidade de recarga de aba e atualizar documentação (38bfb9e)

### Outras mudanças

- alteração na landing page (a854270)

## 0.9.0 — 2026-08-11

### Novidades

- fixar versão do Python para evitar falhas na compilação do better-sqlite3 (b26c98a)

## 0.8.0 — 2026-08-11

### Novidades

- atualizar documentação sobre permissões de chave e adicionar testes para garantir a integridade da chave (0d73643)

## 0.7.0 — 2026-08-11

### Novidades

- implementar criptografia de senhas com armazenamento local e adicionar verificação de persistência (0b9bc34)

## 0.6.0 — 2026-08-11

### Novidades

- adicionar seção de novidades com notas de versão e integração com a API do GitHub (f523240)

### Correções

- adicionar tipos de coluna para diferentes dialetos de banco de dados (139673e)
- adicionar verificação de persistência de senha e melhorar a lógica de conexão no modal (d49db1e)
- melhorar a lógica de criptografia de senhas e garantir a consistência dos dados na UI (e5cb83e)

### Outras mudanças

- adicionar testes para regras de persistência da conexão sem dependências do Electron (d673fda)

## 0.5.0 — 2026-08-11

### Novidades

- implementar funcionalidade de alteração de tipo de coluna, incluindo lógica de confirmação e UI (ac3b038)

## 0.4.0 — 2026-08-11

### Novidades

- implementar sistema de edições pendentes na grade, incluindo lógica de confirmação e UI (a98558c)
- implementar funcionalidade de salvar e listar queries salvas, incluindo UI e lógica de persistência (ac08208)
- adicionar funcionalidade de paginação na aba de tabela e criar instruções de abertura no macOS (aba219c)

### Outras mudanças

- atualizar instruções sobre assinatura e abertura do app no macOS e Windows (7cd6975)

## 0.3.0 — 2026-08-11

### Novidades

- implement update checking and downloading functionality (9e83c31)

## 0.2.0 — 2026-08-11

### Novidades

- add export functionality for tables and enhance data editing capabilities (403aa23)

## 0.1.11 — 2026-08-11

### Outras mudanças

- refatora listDatabases para devolver SCHEMAS e não databases; melhora tratamento de erros e atualiza ações do editor (430493b)
- adiciona verificação de módulo nativo e testes para identificação de binários (8fa6338)

## 0.1.10 — 2026-08-11

### Outras mudanças

- melhora o autocomplete SQL para não sugerir colunas sem tabela em escopo e desativa sugestões de palavras do editor (92bfea1)
- atualiza seção sobre erro 502 no README.md com informações sobre configuração de porta no Railway (5681818)

## 0.1.9 — 2026-08-10

### Outras mudanças

- atualiznador eademe (fea5006)

## 0.1.8 — 2026-08-10

### Outras mudanças

- corrige a descrição e formata a seção de autor no package.json (219a1ff)

## 0.1.7 — 2026-08-10

### Outras mudanças

- substitui .dockerignore da pasta landing e atualiza Dockerfile para refletir a nova estrutura de diretórios; corrige descrição e adiciona tipo de repositório no package.json (8c64e20)

## 0.1.6 — 2026-08-10

### Outras mudanças

- adiciona arquivos de configuração para o servidor Caddy e Docker (f03f0d3)

## 0.1.5 — 2026-08-10

### Outras mudanças

- ajusta configuração de assinatura ad-hoc no macOS e corrige repositório no README (7add2d6)

## 0.1.4 — 2026-08-10

### Outras mudanças

- ajusta posição das curvas batimétricas para evitar rolagem horizontal indesejada (817d902)

## 0.1.3 — 2026-08-10

### Outras mudanças

- adiciona suporte a limite de prévia nas consultas SQL e melhorias na interface de conexão (976585a)
- Refactor code structure for improved readability and maintainability (30bd68f)

## 0.1.2 — 2026-08-10

### Outras mudanças

- adiciona workflow de release e documentação sobre versionamento (5133e1d)
- adiciona informações de versão e commit na tela inicial e no painel "Sobre" (f3312b3)
- adiciona workflow de build e atualiza documentação sobre geração de instaladores (4197ff5)
- adiciona ícones da aplicação e atualiza a configuração do electron-builder (b24ad85)
- criando IDE de banco de dados (e728c3a)
