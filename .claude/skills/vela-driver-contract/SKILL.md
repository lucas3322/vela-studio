---
name: vela-driver-contract
description: Contrato do driver de banco do Vela Studio e o passo a passo para adicionar suporte a um banco novo. Use ao criar ou alterar drivers em src/main/drivers/, ao adicionar um banco (SQL ou NoSQL), ou ao mexer em leitura de schema, execução de query e cancelamento.
---

# Contrato do driver

Todo banco suportado pelo Vela Studio — relacional ou de documentos —
implementa a mesma interface. É isso que permite a UI tratar MongoDB e MySQL
na mesma tela sem `if` espalhado por componente.

## A interface

`src/main/drivers/types.ts`:

```ts
interface DatabaseDriver {
  readonly dialect: Dialect

  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  testConnection(config: ConnectionConfig): Promise<TestResult>

  listDatabases(): Promise<string[]>
  listTables(database?: string): Promise<TableInfo[]>
  listColumns(table: string, database?: string): Promise<ColumnInfo[]>
  listIndexes(table: string, database?: string): Promise<IndexInfo[]>
  listRelations(table: string, database?: string): Promise<RelationInfo[]>

  query(sql: string, options: QueryOptions): Promise<QueryResult[]>
  cancel(queryId: string): Promise<void>

  updateCell(params: EditCellParams): Promise<EditResult>
  deleteRow(params: DeleteRowParams): Promise<EditResult>

  serverVersion(): Promise<string | undefined>
}
```

### `updateCell` / `deleteRow`: as três garantias

A edição em grade escreve no banco do usuário a partir de um duplo clique. Quem
implementar precisa cumprir, sem exceção:

1. **Chave obrigatória.** Passe por `exigirChave()`: chave vazia ou com valor
   nulo é erro, nunca um `WHERE` que sobra. Sem isso, editar uma célula numa
   tabela sem PK reescreveria a coluna inteira em silêncio.
2. **Sempre parametrizado.** O valor e os valores da chave vão como placeholder
   (`?`, `$1`). Só o nome de tabela e de coluna é interpolado, e passando por
   `quoteIdent`.
3. **Transação com teto de uma linha.** Abra transação, execute, e se
   `affectedRows > 1` **desfaça** e lance. Duas linhas afetadas significa que a
   chave não identificava a linha — o usuário achava que editava uma célula.

### `buildAlterColumnTypeStatement`: monta, não executa

Segue o mesmo contrato do `buildDangerStatement` — o driver devolve o SQL, a
UI mostra, o usuário confirma, e só então roda por `query.run`. A UI nunca
escreve DDL.

A armadilha é do MySQL: `MODIFY COLUMN c VARCHAR(50)` reescreve a definição
**inteira** da coluna e apaga `NOT NULL`, `DEFAULT`, `COMMENT` e
`AUTO_INCREMENT` sem erro nenhum. A implementação lê o catálogo antes e
reemite tudo. O Postgres não tem esse problema: `ALTER COLUMN ... TYPE` mexe
só no tipo.

O tipo é interpolado (não existe placeholder para tipo em nenhum banco), então
passa por `exigirTipoValido`, que barra aspas, ponto e vírgula e traço.

Os drivers SQL fazem isso em `escreverComTransacao`. Quem não suporta (Mongo)
lança um erro que **explica o caminho alternativo**, não um erro genérico.
Cada garantia tem teste e2e nas quatro suítes.

## Como bancos NoSQL entram no mesmo molde

| Conceito da UI | SQL | MongoDB |
|---|---|---|
| tabela | table / view | collection |
| coluna | coluna do catálogo | campo inferido por amostragem |
| query | statement SQL | `db.colecao.find({...})` |
| relação | foreign key | não existe → devolve `[]` |

**Regra:** quando o banco não tem o conceito, devolva vazio. Nunca invente
uma relação que o banco não declara — a UI trata lista vazia com elegância,
mas não tem como saber que um dado é fictício.

## Passo a passo para um banco novo

1. **Tipo e metadados** — `src/shared/types.ts`: adicione o `DriverId` e a
   entrada em `DRIVERS`, listando em `fields` os campos que o formulário de
   conexão deve mostrar.

2. **A classe** — `src/main/drivers/<nome>.ts`. Comece por `testConnection`:
   é o primeiro sinal de vida e o que desbloqueia o resto.

3. **Registro** — `createDriver` em `src/main/connection-manager.ts`.

4. **Dialeto no editor** — keywords em `completion.ts`, docs em `sql-docs.ts`,
   receitas em `snippets.ts`.

5. **Testes** — `src/tests/smoke.test.ts` para tudo que for lógica pura.

## Armadilhas já pagas neste projeto

Todas descobertas rodando contra bancos reais. Nenhuma seria pega por typecheck,
e todas falham **em silêncio** — é por isso que este projeto exige teste de
driver contra banco de verdade.

**Caixa dos nomes de coluna do catálogo.** No MySQL 8 as views do
`information_schema` devolvem `TABLE_NAME`; no 5.7, `table_name`. Ler
`row.table_name` devolve `undefined` sem erro, e a barra lateral mostra 209
tabelas sem nome. **Sempre alias explícito** em consulta de catálogo:
`SELECT table_name AS name`.

**Linha como objeto colapsa colunas homônimas.** `SELECT c.id, p.id` de um JOIN
tem duas colunas chamadas `id`; em formato de objeto a segunda apaga a primeira
e o usuário vê uma coluna a menos. Leia como array — `rowsAsArray` (mysql2),
`rowMode: 'array'` (pg), `.raw()` + `.columns()` (better-sqlite3) — e monte o
grid com `toGridFromArrays`, que indexa por posição.

**Structured clone.** Tudo que atravessa o IPC precisa sobreviver a ele.
`Date`, `BigInt`, `Buffer` e `ObjectId` não sobrevivem crus — passe por
`serializeValue()` em `value-types.ts`.

**Arrays do Postgres com tipo sem parser.** `array_agg` sobre uma coluna do tipo
`name` produz `name[]`, para o qual o `pg` não tem parser: volta a string crua
`'{status}'`. Faça cast: `array_agg(a.attname::text)`.

**Realms.** Não avalie expressão do usuário em `vm.runInNewContext`: objetos,
arrays e regexes nascem com o protótipo daquele realm, e o serializador BSON
usa `instanceof RegExp`, que retorna `false` entre realms. O filtro é
descartado em silêncio. Veja o comentário em `mongo-parser.ts`.

**Precisão numérica.** O driver `pg` devolve `int8` e `numeric` como string
para não perder precisão; o `mysql2` devolve `DECIMAL` como string por padrão.
Os dois estão configurados para converter — o alinhamento do grid depende
disso.

**Cancelamento não é opcional.** MySQL: `KILL QUERY <id>` em **outra** conexão,
porque a original está bloqueada esperando o servidor. Postgres:
`pg_cancel_backend(pid)`. SQLite: impossível (`better-sqlite3` é síncrono) —
implemente vazio e documente.

**Citação de identificador.** MySQL usa crase, Postgres e SQLite usam aspas
duplas, e a aspa interna dobra. Errar isso quebra qualquer nome com espaço.

**Teto de linhas.** `DEFAULT_MAX_ROWS` é 50.000. Corte no driver e preencha
`truncatedAt` — a UI avisa o usuário a partir desse campo.

## Antes de terminar

```bash
npm run typecheck && npm test
docker compose -f src/tests/docker-compose.yml up -d --wait && npm run test:db
```

O `npm test` cobre só lógica pura. Mudança em driver **exige** o `test:db`:
todos os bugs da lista acima passavam pelo typecheck e pelos testes unitários.
