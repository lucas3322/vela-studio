/**
 * Dicionário de SQL em português.
 *
 * É a peça que faz a IDE ensinar em vez de só executar: passar o mouse em
 * qualquer palavra-chave explica o que ela faz, com um exemplo curto.
 * Escrito para quem nunca viu SQL, sem ficar bobo para quem já sabe.
 */

export interface SqlDoc {
  /** Resumo de uma linha, o que aparece na lista de autocomplete. */
  summary: string
  /** Explicação completa, exibida no hover. */
  detail: string
  example?: string
  /** Armadilha comum — o que costuma dar errado com essa palavra. */
  gotcha?: string
  category: 'clausula' | 'juncao' | 'operador' | 'funcao' | 'modificador' | 'ddl' | 'dml'
}

export const SQL_DOCS: Record<string, SqlDoc> = {
  // ── Junção e apelido ──────────────────────────────────────────────
  JOIN: {
    category: 'juncao',
    summary: 'Combina linhas de duas tabelas',
    detail:
      'Escrito sozinho, `JOIN` significa `INNER JOIN`: só as linhas que casam dos **dois** lados entram. Os bancos aceitam a forma curta, mas escrever o tipo deixa claro para quem lê depois.',
    example: 'SELECT p.id, c.nome FROM pedidos p JOIN clientes c ON c.id = p.cliente_id',
    gotcha: 'Esquecer o `ON` produz um produto cartesiano: 1.000 × 1.000 vira um milhão de linhas.'
  },
  AS: {
    category: 'modificador',
    summary: 'Dá um apelido a uma coluna ou tabela',
    detail:
      'Renomeia o resultado só na saída da consulta — nada muda no banco. Serve para encurtar nome de tabela (`clientes c`) e para batizar uma expressão (`SUM(valor) AS total`).',
    example: 'SELECT SUM(valor) AS total_vendido FROM pedidos p',
    gotcha:
      'O apelido criado no `SELECT` não pode ser usado no `WHERE` da mesma consulta: o `WHERE` roda antes. Use no `HAVING` ou repita a expressão.'
  },

  // ── Operadores lógicos ────────────────────────────────────────────
  AND: {
    category: 'operador',
    summary: 'Exige que as duas condições sejam verdadeiras',
    detail: 'A linha só entra se **ambos** os lados forem verdadeiros.',
    example: "SELECT * FROM pedidos WHERE status = 'pago' AND valor > 100"
  },
  OR: {
    category: 'operador',
    summary: 'Basta uma das condições ser verdadeira',
    detail: 'A linha entra se **qualquer** um dos lados for verdadeiro.',
    example: "SELECT * FROM pedidos WHERE status = 'novo' OR status = 'pago'",
    gotcha:
      '`AND` tem precedência sobre `OR`: `a AND b OR c` é lido como `(a AND b) OR c`. Use parênteses quando misturar os dois.'
  },
  NOT: {
    category: 'operador',
    summary: 'Inverte a condição',
    detail: 'Nega o que vem depois — `NOT IN`, `NOT LIKE`, `NOT EXISTS`.',
    example: "SELECT * FROM clientes WHERE cidade NOT IN ('Recife', 'Olinda')",
    gotcha:
      '`NOT IN` com uma lista que contenha `NULL` não devolve nenhuma linha, porque a comparação com nulo é desconhecida, não falsa.'
  },

  // ── Ordenação e conjuntos ─────────────────────────────────────────
  ASC: {
    category: 'modificador',
    summary: 'Ordena do menor para o maior',
    detail: 'É o padrão do `ORDER BY` — escrever é opcional, mas deixa a intenção explícita.',
    example: 'SELECT * FROM clientes ORDER BY nome ASC'
  },
  DESC: {
    category: 'modificador',
    summary: 'Ordena do maior para o menor',
    detail: 'Inverte a ordem. Usado para "mais recentes primeiro" e "maiores valores primeiro".',
    example: 'SELECT * FROM pedidos ORDER BY criado_em DESC'
  },
  'UNION ALL': {
    category: 'clausula',
    summary: 'Empilha resultados sem remover repetidos',
    detail:
      'Junta o resultado de duas consultas uma embaixo da outra, mantendo linhas iguais. É mais rápido que `UNION`, que precisa comparar tudo para eliminar duplicatas.',
    example: 'SELECT nome FROM clientes UNION ALL SELECT nome FROM fornecedores',
    gotcha: 'As duas consultas precisam ter o mesmo número de colunas, e tipos compatíveis.'
  },

  // ── CASE ──────────────────────────────────────────────────────────
  WHEN: {
    category: 'operador',
    summary: 'Abre uma condição dentro do CASE',
    detail: 'Cada `WHEN` testa uma condição; o primeiro que der verdadeiro define o resultado.',
    example: "CASE WHEN valor > 1000 THEN 'alto' ELSE 'normal' END"
  },
  THEN: {
    category: 'operador',
    summary: 'O valor devolvido quando o WHEN acerta',
    detail: 'Vem logo depois da condição e diz o que aquela condição produz.',
    example: "CASE WHEN status = 'pago' THEN 1 ELSE 0 END"
  },
  ELSE: {
    category: 'operador',
    summary: 'O valor quando nenhuma condição acertou',
    detail: 'Fecha o `CASE` com um padrão.',
    example: "CASE WHEN ativo = 1 THEN 'sim' ELSE 'não' END",
    gotcha: 'Sem `ELSE`, o `CASE` devolve `NULL` quando nada casa — e nulo costuma passar batido.'
  },
  END: {
    category: 'operador',
    summary: 'Encerra o bloco CASE',
    detail: 'Todo `CASE` precisa de `END`. Um apelido com `AS` costuma vir logo depois.',
    example: "CASE WHEN x > 0 THEN 'positivo' ELSE 'zero ou negativo' END AS sinal"
  },

  // ── Escrita ───────────────────────────────────────────────────────
  'INSERT INTO': {
    category: 'dml',
    summary: 'Grava linhas novas na tabela',
    detail:
      'Listar as colunas explicitamente é o que protege a instrução: sem a lista, ela depende da ordem física das colunas e quebra quando alguém acrescenta uma.',
    example: "INSERT INTO clientes (nome, email) VALUES ('Ana', 'ana@x.com')"
  },
  VALUES: {
    category: 'dml',
    summary: 'Os dados que serão inseridos',
    detail: 'Vem depois do `INSERT INTO`, na mesma ordem das colunas listadas.',
    example: "INSERT INTO clientes (nome, cidade) VALUES ('Ana', 'Recife'), ('Bruno', 'Olinda')"
  },
  SET: {
    category: 'dml',
    summary: 'As colunas e os novos valores do UPDATE',
    detail: 'Define o que muda. Várias colunas de uma vez, separadas por vírgula.',
    example: "UPDATE pedidos SET status = 'pago', pago_em = NOW() WHERE id = 7",
    gotcha: 'Sem `WHERE`, o `SET` atinge a tabela inteira — e não há como desfazer.'
  },
  'DELETE FROM': {
    category: 'dml',
    summary: 'Apaga linhas da tabela',
    detail: 'Remove as linhas que o `WHERE` selecionar. A estrutura da tabela fica.',
    example: 'DELETE FROM logs WHERE criado_em < NOW() - INTERVAL 90 DAY',
    gotcha: 'Sem `WHERE`, apaga tudo. Rode antes o mesmo comando como `SELECT` para ver o que sairá.'
  },

  // ── Funções de texto e número ─────────────────────────────────────
  UPPER: {
    category: 'funcao',
    summary: 'Converte o texto para maiúsculas',
    detail: 'Útil para comparar sem depender de como o dado foi digitado.',
    example: "SELECT * FROM clientes WHERE UPPER(nome) = 'ANA'",
    gotcha: 'Usar função na coluna impede o banco de aproveitar o índice dela.'
  },
  LOWER: {
    category: 'funcao',
    summary: 'Converte o texto para minúsculas',
    detail: 'O par de `UPPER`, com a mesma ressalva sobre índice.',
    example: 'SELECT LOWER(email) FROM clientes'
  },
  TRIM: {
    category: 'funcao',
    summary: 'Remove espaços das pontas',
    detail: 'Limpa espaço no começo e no fim — a causa comum de "o filtro não acha o registro".',
    example: 'SELECT * FROM clientes WHERE TRIM(nome) = :nome'
  },
  LENGTH: {
    category: 'funcao',
    summary: 'Conta os caracteres do texto',
    detail: 'Serve para achar dado truncado ou fora do formato esperado.',
    example: 'SELECT * FROM clientes WHERE LENGTH(cnpj) <> 14'
  },
  ROUND: {
    category: 'funcao',
    summary: 'Arredonda o número',
    detail: 'O segundo argumento é quantas casas decimais manter.',
    example: 'SELECT ROUND(AVG(valor), 2) FROM pedidos'
  },
  ABS: {
    category: 'funcao',
    summary: 'Valor absoluto, sem o sinal',
    detail: 'Transforma negativo em positivo.',
    example: 'SELECT ABS(saldo) FROM contas'
  },
  CONCAT: {
    category: 'funcao',
    summary: 'Junta textos',
    detail: 'Emenda dois ou mais valores num só.',
    example: "SELECT CONCAT(nome, ' <', email, '>') FROM clientes",
    gotcha: 'No MySQL, se qualquer parte for `NULL` o resultado inteiro vira `NULL`. Use `COALESCE`.'
  },
  SUBSTRING: {
    category: 'funcao',
    summary: 'Recorta um pedaço do texto',
    detail: 'Recebe a posição inicial e quantos caracteres levar. A contagem começa em 1, não em 0.',
    example: 'SELECT SUBSTRING(cnpj, 1, 8) FROM empresas'
  },
  REPLACE: {
    category: 'funcao',
    summary: 'Troca um trecho do texto por outro',
    detail: 'Substitui todas as ocorrências encontradas.',
    example: "SELECT REPLACE(telefone, '-', '') FROM clientes"
  },

  // ── Específicas de dialeto ────────────────────────────────────────
  IFNULL: {
    category: 'funcao',
    summary: 'Devolve um substituto quando o valor é nulo',
    detail: 'Versão de dois argumentos do `COALESCE`, no MySQL e no SQLite.',
    example: 'SELECT IFNULL(apelido, nome) FROM clientes'
  },
  GROUP_CONCAT: {
    category: 'funcao',
    summary: 'Junta os valores de um grupo numa string',
    detail: 'Agrega várias linhas num texto só, separado por vírgula.',
    example: 'SELECT cliente_id, GROUP_CONCAT(produto) FROM itens GROUP BY cliente_id',
    gotcha: 'No MySQL o resultado é cortado em 1024 bytes por padrão (`group_concat_max_len`).'
  },
  'NOW()': {
    category: 'funcao',
    summary: 'Data e hora atuais do servidor',
    detail: 'Vem do relógio do **banco**, não do seu computador.',
    example: 'UPDATE pedidos SET pago_em = NOW() WHERE id = 7'
  },
  'CURDATE()': {
    category: 'funcao',
    summary: 'Data de hoje, sem a hora',
    detail: 'Equivale a `CURRENT_DATE` no MySQL.',
    example: 'SELECT * FROM pedidos WHERE DATE(criado_em) = CURDATE()'
  },
  CURRENT_DATE: {
    category: 'funcao',
    summary: 'Data de hoje, sem a hora',
    detail: 'Padrão SQL, disponível no PostgreSQL.',
    example: 'SELECT * FROM pedidos WHERE criado_em::date = CURRENT_DATE'
  },
  DATE_FORMAT: {
    category: 'funcao',
    summary: 'Formata data como texto',
    detail: 'Do MySQL. Recebe a data e a máscara de saída.',
    example: "SELECT DATE_FORMAT(criado_em, '%d/%m/%Y') FROM pedidos"
  },
  RETURNING: {
    category: 'dml',
    summary: 'Devolve as linhas que foram gravadas',
    detail:
      'Do PostgreSQL. Faz o `INSERT`, `UPDATE` ou `DELETE` retornar as linhas afetadas — evita uma segunda consulta para descobrir o id gerado.',
    example: "INSERT INTO clientes (nome) VALUES ('Ana') RETURNING id"
  },
  JSONB_AGG: {
    category: 'funcao',
    summary: 'Agrega as linhas do grupo num array JSON',
    detail: 'Do PostgreSQL. Útil para devolver dados aninhados numa consulta só.',
    example: 'SELECT cliente_id, JSONB_AGG(item) FROM pedidos GROUP BY cliente_id'
  },
  ARRAY_AGG: {
    category: 'funcao',
    summary: 'Agrega os valores do grupo num array',
    detail: 'Do PostgreSQL. Equivale ao `GROUP_CONCAT`, mas devolve array de verdade.',
    example: 'SELECT cidade, ARRAY_AGG(nome) FROM clientes GROUP BY cidade'
  },
  "DATETIME('NOW')": {
    category: 'funcao',
    summary: 'Data e hora atuais no SQLite',
    detail: 'O SQLite não tem `NOW()`; usa-se `datetime(\'now\')`, em UTC por padrão.',
    example: "UPDATE pedidos SET pago_em = datetime('now') WHERE id = 7",
    gotcha: "Devolve UTC. Para o horário local, use datetime('now', 'localtime')."
  },

  SELECT: {
    category: 'clausula',
    summary: 'Escolhe quais colunas trazer',
    detail:
      'Abre a consulta e define **quais colunas** você quer ver. `SELECT *` traz todas — prático para explorar, ruim para produção, porque puxa dados que você não vai usar.',
    example: 'SELECT nome, email FROM clientes',
    gotcha: 'Numa tabela larga, `SELECT *` pode trazer megabytes desnecessários por linha.'
  },
  FROM: {
    category: 'clausula',
    summary: 'Define de qual tabela vêm os dados',
    detail: 'Diz **de onde** as linhas saem. Pode receber uma tabela, uma view ou uma subconsulta.',
    example: 'SELECT * FROM pedidos'
  },
  WHERE: {
    category: 'clausula',
    summary: 'Filtra quais linhas entram no resultado',
    detail:
      'Mantém apenas as linhas em que a condição é verdadeira. Roda **antes** de qualquer agrupamento.',
    example: "SELECT * FROM pedidos WHERE status = 'pago'",
    gotcha: 'Não dá para usar funções de agregação aqui (`COUNT`, `SUM`). Para isso existe o `HAVING`.'
  },
  'GROUP BY': {
    category: 'clausula',
    summary: 'Junta linhas iguais em um grupo só',
    detail:
      'Colapsa linhas que compartilham o mesmo valor em uma só, para que funções como `COUNT` e `SUM` calculem por grupo.',
    example: 'SELECT cidade, COUNT(*) FROM clientes GROUP BY cidade',
    gotcha: 'Toda coluna do SELECT precisa estar no GROUP BY ou dentro de uma função de agregação.'
  },
  HAVING: {
    category: 'clausula',
    summary: 'Filtra grupos depois do GROUP BY',
    detail:
      'É o `WHERE` dos grupos: roda **depois** do agrupamento, então enxerga o resultado de `COUNT`, `SUM` e afins.',
    example: 'SELECT cidade, COUNT(*) c FROM clientes GROUP BY cidade HAVING COUNT(*) > 10'
  },
  'ORDER BY': {
    category: 'clausula',
    summary: 'Ordena o resultado',
    detail: 'Ordena as linhas. `ASC` é crescente (padrão), `DESC` é decrescente.',
    example: 'SELECT * FROM produtos ORDER BY preco DESC',
    gotcha: 'Sem ORDER BY, o banco não garante nenhuma ordem — nem a mesma entre duas execuções.'
  },
  LIMIT: {
    category: 'modificador',
    summary: 'Limita quantas linhas voltam',
    detail: 'Corta o resultado em N linhas. É o primeiro reflexo ao explorar uma tabela desconhecida.',
    example: 'SELECT * FROM logs ORDER BY criado_em DESC LIMIT 100'
  },
  OFFSET: {
    category: 'modificador',
    summary: 'Pula as primeiras N linhas',
    detail: 'Usado com `LIMIT` para paginar resultados.',
    example: 'SELECT * FROM produtos ORDER BY id LIMIT 20 OFFSET 40',
    gotcha: 'OFFSET alto fica lento: o banco ainda precisa varrer as linhas puladas.'
  },
  'INNER JOIN': {
    category: 'juncao',
    summary: 'Só as linhas que existem nas duas tabelas',
    detail:
      'Combina duas tabelas mantendo **apenas** as linhas com correspondência dos dois lados. Sem par, a linha some.',
    example: 'SELECT p.id, c.nome FROM pedidos p INNER JOIN clientes c ON c.id = p.cliente_id'
  },
  'LEFT JOIN': {
    category: 'juncao',
    summary: 'Tudo da esquerda, com o que casar da direita',
    detail:
      'Mantém **todas** as linhas da tabela da esquerda. Quando não há correspondência na direita, as colunas dela vêm como `NULL`.',
    example: 'SELECT c.nome, p.id FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id',
    gotcha:
      'Filtrar a tabela da direita no `WHERE` transforma o LEFT JOIN em INNER JOIN sem avisar. Coloque a condição no `ON`.'
  },
  'RIGHT JOIN': {
    category: 'juncao',
    summary: 'Tudo da direita, com o que casar da esquerda',
    detail: 'O espelho do LEFT JOIN. Na prática quase todo mundo prefere inverter as tabelas e usar LEFT.',
    example: 'SELECT * FROM a RIGHT JOIN b ON b.a_id = a.id'
  },
  'FULL JOIN': {
    category: 'juncao',
    summary: 'Tudo dos dois lados',
    detail: 'Traz todas as linhas das duas tabelas, preenchendo com `NULL` onde não há par.',
    example: 'SELECT * FROM a FULL OUTER JOIN b ON b.a_id = a.id',
    gotcha: 'MySQL não tem FULL JOIN; simula-se com `UNION` de um LEFT e um RIGHT.'
  },
  'CROSS JOIN': {
    category: 'juncao',
    summary: 'Combina cada linha com todas as outras',
    detail: 'Produto cartesiano: 1.000 × 1.000 vira 1.000.000 de linhas.',
    example: 'SELECT * FROM tamanhos CROSS JOIN cores',
    gotcha: 'JOIN sem ON vira CROSS JOIN por acidente — e derruba a consulta.'
  },
  ON: {
    category: 'juncao',
    summary: 'A condição que liga duas tabelas',
    detail: 'Define qual coluna de uma tabela corresponde a qual da outra.',
    example: 'ON pedidos.cliente_id = clientes.id'
  },
  'IS NULL': {
    category: 'operador',
    summary: 'Verifica ausência de valor',
    detail:
      '`NULL` significa "não sabemos". Por isso `= NULL` nunca dá verdadeiro: é preciso usar `IS NULL`.',
    example: 'SELECT * FROM clientes WHERE telefone IS NULL',
    gotcha: 'Este é o erro mais comum de quem está começando: `WHERE campo = NULL` retorna zero linhas, sempre.'
  },
  'IS NOT NULL': {
    category: 'operador',
    summary: 'Verifica presença de valor',
    detail: 'Mantém apenas as linhas em que a coluna foi preenchida.',
    example: 'SELECT * FROM contratos WHERE assinado_em IS NOT NULL'
  },
  LIKE: {
    category: 'operador',
    summary: 'Busca por padrão de texto',
    detail: '`%` casa com qualquer sequência, `_` com um caractere só.',
    example: "SELECT * FROM clientes WHERE nome LIKE 'Mar%'",
    gotcha: 'Começar o padrão com `%` impede o uso de índice e faz varredura completa da tabela.'
  },
  ILIKE: {
    category: 'operador',
    summary: 'LIKE que ignora maiúsculas (PostgreSQL)',
    detail: 'Igual ao `LIKE`, mas sem diferenciar maiúsculas de minúsculas.',
    example: "SELECT * FROM clientes WHERE nome ILIKE '%silva%'"
  },
  IN: {
    category: 'operador',
    summary: 'Valor está em uma lista',
    detail: 'Atalho para vários `OR`. Aceita lista literal ou subconsulta.',
    example: "SELECT * FROM pedidos WHERE status IN ('novo', 'pago')",
    gotcha: 'Se a lista contiver `NULL`, o `NOT IN` para de funcionar como você espera.'
  },
  BETWEEN: {
    category: 'operador',
    summary: 'Valor dentro de um intervalo',
    detail: 'Inclui os dois extremos.',
    example: "SELECT * FROM vendas WHERE data BETWEEN '2024-01-01' AND '2024-01-31'",
    gotcha:
      'Com colunas de data e hora, `BETWEEN` até o dia 31 exclui tudo depois das 00:00 daquele dia.'
  },
  EXISTS: {
    category: 'operador',
    summary: 'Verifica se a subconsulta retorna algo',
    detail: 'Para na primeira linha encontrada — costuma ser mais rápido que `IN` com subconsulta grande.',
    example: 'SELECT * FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id)'
  },
  DISTINCT: {
    category: 'modificador',
    summary: 'Remove linhas duplicadas',
    detail: 'Elimina resultados repetidos considerando todas as colunas do SELECT.',
    example: 'SELECT DISTINCT cidade FROM clientes',
    gotcha: 'DISTINCT em muitas colunas é caro: o banco precisa ordenar ou montar hash de tudo.'
  },
  COUNT: {
    category: 'funcao',
    summary: 'Conta linhas',
    detail: '`COUNT(*)` conta todas as linhas; `COUNT(coluna)` ignora os `NULL` daquela coluna.',
    example: 'SELECT COUNT(*) FROM pedidos'
  },
  SUM: { category: 'funcao', summary: 'Soma valores', detail: 'Soma uma coluna numérica, ignorando `NULL`.', example: 'SELECT SUM(valor) FROM pedidos' },
  AVG: { category: 'funcao', summary: 'Calcula a média', detail: 'Média aritmética, ignorando `NULL`.', example: 'SELECT AVG(nota) FROM avaliacoes' },
  MIN: { category: 'funcao', summary: 'Menor valor', detail: 'Funciona com número, texto e data.', example: 'SELECT MIN(criado_em) FROM contas' },
  MAX: { category: 'funcao', summary: 'Maior valor', detail: 'Funciona com número, texto e data.', example: 'SELECT MAX(valor) FROM pedidos' },
  COALESCE: {
    category: 'funcao',
    summary: 'Primeiro valor não nulo',
    detail: 'Percorre os argumentos e devolve o primeiro que não for `NULL`. Ideal para valor padrão.',
    example: "SELECT COALESCE(apelido, nome, 'sem nome') FROM usuarios"
  },
  CASE: {
    category: 'funcao',
    summary: 'Condicional dentro da query',
    detail: 'O `if/else` do SQL. Avalia condições em ordem e devolve o primeiro resultado que casar.',
    example: "SELECT CASE WHEN valor > 1000 THEN 'alto' ELSE 'normal' END FROM pedidos"
  },
  CAST: {
    category: 'funcao',
    summary: 'Converte tipo de dado',
    detail: 'Transforma um valor em outro tipo.',
    example: "SELECT CAST('42' AS INTEGER)"
  },
  INSERT: {
    category: 'dml',
    summary: 'Adiciona linhas novas',
    detail: 'Insere registros na tabela. Liste as colunas explicitamente — a ordem física pode mudar.',
    example: "INSERT INTO clientes (nome, email) VALUES ('Ana', 'ana@x.com')"
  },
  UPDATE: {
    category: 'dml',
    summary: 'Altera linhas existentes',
    detail: 'Modifica registros que atendem à condição do `WHERE`.',
    example: "UPDATE pedidos SET status = 'enviado' WHERE id = 42",
    gotcha: '**Sem `WHERE`, atualiza a tabela inteira.** Rode o `SELECT` equivalente antes.'
  },
  DELETE: {
    category: 'dml',
    summary: 'Remove linhas',
    detail: 'Apaga registros que atendem à condição.',
    example: 'DELETE FROM sessoes WHERE expirou_em < NOW()',
    gotcha: '**Sem `WHERE`, apaga tudo.** Não há desfazer fora de uma transação.'
  },
  'CREATE TABLE': {
    category: 'ddl',
    summary: 'Cria uma tabela',
    detail: 'Define nome, colunas, tipos e restrições da nova tabela.',
    example: 'CREATE TABLE times (id INT PRIMARY KEY, nome VARCHAR(80) NOT NULL)'
  },
  'ALTER TABLE': { category: 'ddl', summary: 'Modifica a estrutura da tabela', detail: 'Adiciona, remove ou altera colunas e restrições.', example: 'ALTER TABLE clientes ADD COLUMN telefone VARCHAR(20)' },
  'DROP TABLE': { category: 'ddl', summary: 'Apaga a tabela inteira', detail: 'Remove a tabela e todos os seus dados.', example: 'DROP TABLE temporaria', gotcha: 'Irreversível. Estrutura e dados somem juntos.' },
  TRUNCATE: { category: 'ddl', summary: 'Esvazia a tabela', detail: 'Apaga todas as linhas mantendo a estrutura. Mais rápido que `DELETE`.', example: 'TRUNCATE TABLE staging', gotcha: 'Não dispara triggers e, em muitos bancos, não pode ser desfeito por rollback.' },
  UNION: { category: 'clausula', summary: 'Empilha resultados de duas queries', detail: 'Junta resultados removendo duplicatas. `UNION ALL` mantém tudo e é mais rápido.', example: 'SELECT nome FROM a UNION SELECT nome FROM b', gotcha: 'As duas queries precisam ter o mesmo número de colunas, com tipos compatíveis.' },
  WITH: { category: 'clausula', summary: 'Cria uma consulta nomeada (CTE)', detail: 'Dá nome a uma subconsulta para reutilizar e deixar a query legível.', example: 'WITH ativos AS (SELECT * FROM clientes WHERE ativo) SELECT * FROM ativos' },
  'ORDER': { category: 'clausula', summary: 'Início de ORDER BY', detail: 'Combine com `BY` para ordenar o resultado.' },
  'GROUP': { category: 'clausula', summary: 'Início de GROUP BY', detail: 'Combine com `BY` para agrupar linhas.' }
}

/** Documentação de operadores do MongoDB, no mesmo espírito. */
export const MONGO_DOCS: Record<string, SqlDoc> = {
  find: { category: 'clausula', summary: 'Busca documentos', detail: 'Retorna os documentos que casam com o filtro. Sem filtro, retorna todos.', example: 'db.clientes.find({ ativo: true }).limit(20)' },
  findOne: { category: 'clausula', summary: 'Busca um documento', detail: 'Retorna o primeiro documento que casa com o filtro, ou `null`.', example: 'db.clientes.findOne({ email: "a@x.com" })' },
  aggregate: { category: 'clausula', summary: 'Pipeline de agregação', detail: 'Processa documentos em estágios encadeados. É o equivalente a `GROUP BY` com esteroides.', example: 'db.vendas.aggregate([{ $group: { _id: "$cidade", total: { $sum: "$valor" } } }])' },
  $match: { category: 'operador', summary: 'Filtra no pipeline', detail: 'O `WHERE` da agregação. Coloque o mais cedo possível para reduzir o volume.', example: '{ $match: { status: "pago" } }' },
  $group: { category: 'operador', summary: 'Agrupa documentos', detail: 'O `GROUP BY`. O campo `_id` define a chave do grupo.', example: '{ $group: { _id: "$cidade", total: { $sum: 1 } } }' },
  $sort: { category: 'operador', summary: 'Ordena', detail: '`1` é crescente, `-1` é decrescente.', example: '{ $sort: { criadoEm: -1 } }' },
  $lookup: { category: 'juncao', summary: 'Junta com outra coleção', detail: 'O JOIN do Mongo. Traz documentos relacionados como um array.', example: '{ $lookup: { from: "pedidos", localField: "_id", foreignField: "clienteId", as: "pedidos" } }' },
  $gt: { category: 'operador', summary: 'Maior que', detail: 'Compara valores numéricos ou de data.', example: '{ idade: { $gt: 18 } }' },
  $gte: { category: 'operador', summary: 'Maior ou igual', detail: 'Inclui o limite.', example: '{ idade: { $gte: 18 } }' },
  $lt: { category: 'operador', summary: 'Menor que', detail: 'Compara valores numéricos ou de data.', example: '{ preco: { $lt: 100 } }' },
  $lte: { category: 'operador', summary: 'Menor ou igual', detail: 'Inclui o limite.', example: '{ preco: { $lte: 100 } }' },
  $in: { category: 'operador', summary: 'Valor está na lista', detail: 'Equivale ao `IN` do SQL.', example: '{ status: { $in: ["novo", "pago"] } }' },
  $ne: { category: 'operador', summary: 'Diferente de', detail: 'Documentos em que o campo é diferente do valor — inclui os que não têm o campo.', example: '{ status: { $ne: "cancelado" } }' },
  $exists: { category: 'operador', summary: 'Campo existe', detail: 'Filtra pela presença ou ausência do campo no documento.', example: '{ telefone: { $exists: true } }' },
  $regex: { category: 'operador', summary: 'Busca por expressão regular', detail: 'Equivalente ao `LIKE`. Use `$options: "i"` para ignorar maiúsculas.', example: '{ nome: { $regex: "^Mar", $options: "i" } }' },
  $and: { category: 'operador', summary: 'Todas as condições', detail: 'Condições no mesmo objeto já são AND; use `$and` quando precisar repetir um campo.', example: '{ $and: [{ a: 1 }, { b: 2 }] }' },
  $or: { category: 'operador', summary: 'Qualquer condição', detail: 'Casa se pelo menos uma condição for verdadeira.', example: '{ $or: [{ status: "novo" }, { urgente: true }] }' },
  $set: { category: 'operador', summary: 'Define campos na atualização', detail: 'Altera apenas os campos informados, preservando o resto do documento.', example: 'db.clientes.updateOne({ _id: id }, { $set: { ativo: false } })' },
  $unset: { category: 'operador', summary: 'Remove campos', detail: 'Apaga o campo do documento.', example: '{ $unset: { temporario: "" } }' },
  $inc: { category: 'operador', summary: 'Incrementa um número', detail: 'Soma ao valor atual. Use negativo para subtrair.', example: '{ $inc: { visualizacoes: 1 } }' },
  limit: { category: 'modificador', summary: 'Limita a quantidade', detail: 'Corta o cursor em N documentos.', example: 'db.logs.find().limit(50)' },
  sort: { category: 'modificador', summary: 'Ordena o cursor', detail: '`1` crescente, `-1` decrescente.', example: 'db.logs.find().sort({ data: -1 })' },
  countDocuments: { category: 'funcao', summary: 'Conta documentos', detail: 'Contagem exata que respeita o filtro.', example: 'db.pedidos.countDocuments({ status: "pago" })' }
}

/** Busca a doc de um termo, tolerando maiúsculas e palavras compostas. */
export function lookupDoc(word: string, dialect: string): SqlDoc | undefined {
  if (dialect === 'mongodb') {
    return MONGO_DOCS[word] ?? MONGO_DOCS[word.toLowerCase()]
  }
  return SQL_DOCS[word.toUpperCase()]
}
