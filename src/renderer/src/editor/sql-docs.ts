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
