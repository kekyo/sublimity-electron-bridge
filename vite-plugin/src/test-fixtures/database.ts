@ExposeToRenderer("databaseAPI")
export async function queryDatabase(sql: string): Promise<any[]> {
  return []
}

@ExposeToRenderer("databaseAPI")
export async function executeCommand(command: string): Promise<number> {
  return 0
}

@ExposeToRenderer()
export async function getVersion(): Promise<string> {
  return "1.0.0"
}