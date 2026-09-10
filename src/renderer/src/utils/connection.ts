import { DRIVERS, type StoredConnection } from '@shared/types'

/**
 * A conexão exige senha e não tem nenhuma guardada?
 *
 * SQLite não usa senha, e uma string de conexão normalmente já a carrega — nos
 * dois casos não há o que pedir. Quando falta mesmo, conectar direto só
 * produziria um "Access denied" do banco; quem chama abre o formulário pedindo
 * só a senha em vez de falhar.
 */
export function needsPassword(connection: StoredConnection): boolean {
  if (connection.hasPassword) return false
  if (!DRIVERS[connection.driver].fields.includes('password')) return false
  if (connection.connectionString?.trim()) return false
  return true
}
