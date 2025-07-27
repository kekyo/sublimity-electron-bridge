/**
 * @decorator expose databaseAPI
 */
export async function queryDatabase(sql: string): Promise<any[]> {
  return []
}

/**
 * @decorator expose databaseAPI
 */
export async function executeCommand(command: string): Promise<number> {
  return 0
}

/**
 * @decorator expose
 */
export async function getVersion(): Promise<string> {
  return "1.0.0"
}