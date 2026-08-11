import type { Dialect } from '@shared/types'

/**
 * Tipos oferecidos ao editar uma coluna.
 *
 * A lista **sugere, não restringe**: vai para um `<datalist>`, então continua
 * possível digitar `decimal(12,4)`, `enum('a','b')` ou qualquer tipo do banco
 * que não esteja aqui. Uma lista fechada seria pior que nenhuma — todo banco
 * tem tipo que a gente esqueceu, e não abrir a porta para ele transformaria a
 * funcionalidade numa gaiola.
 *
 * A ordem é por frequência de uso, não alfabética: quem procura `varchar(255)`
 * não deveria passar por `bit` antes.
 */
export function tiposDoDialeto(dialect: Dialect): string[] {
  return TIPOS[dialect] ?? []
}

const MYSQL = [
  'varchar(255)',
  'varchar(100)',
  'varchar(50)',
  'text',
  'longtext',
  'int',
  'int unsigned',
  'bigint',
  'bigint unsigned',
  'tinyint(1)',
  'smallint',
  'decimal(10,2)',
  'double',
  'float',
  'date',
  'datetime',
  'timestamp',
  'time',
  'year',
  'json',
  'char(36)',
  'blob',
  'binary(16)'
]

const POSTGRES = [
  'varchar(255)',
  'varchar(100)',
  'text',
  'integer',
  'bigint',
  'smallint',
  'serial',
  'bigserial',
  'boolean',
  'numeric(10,2)',
  'real',
  'double precision',
  'date',
  'timestamp',
  'timestamptz',
  'time',
  'interval',
  'json',
  'jsonb',
  'uuid',
  'bytea',
  'inet'
]

/**
 * O SQLite tem afinidade de tipo, não tipo — e nem permite alterar coluna.
 * A lista existe só para consulta; a edição está desabilitada nesse dialeto.
 */
const SQLITE = ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC']

const TIPOS: Record<string, string[]> = {
  mysql: MYSQL,
  postgres: POSTGRES,
  sqlite: SQLITE,
  // MongoDB não tem tipo de coluna: o tipo vive em cada documento.
  mongodb: []
}
