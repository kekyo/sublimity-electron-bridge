/**
 * @decorator expose systemAPI
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version,
    arch: process.arch
  }
}

/**
 * @decorator expose systemAPI
 */
export async function getMemoryUsage(): Promise<NodeJS.MemoryUsage> {
  return process.memoryUsage()
}

/**
 * @decorator expose
 */
export async function getUptime(): Promise<number> {
  return process.uptime()
}

interface SystemInfo {
  platform: string
  version: string
  arch: string
}