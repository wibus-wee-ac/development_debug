import type { McpServerConfig } from '@cradle/plugin-sdk/server'

const registry = new Map<string, McpServerConfig>()

export function registerMcpServer(config: McpServerConfig): void {
  registry.set(config.name, config)
}

export function unregisterMcpServer(name: string): void {
  registry.delete(name)
}

export function getRegisteredMcpServers(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  return Object.fromEntries(
    [...registry.entries()].map(([name, c]) => [name, { command: c.command, args: c.args, env: c.env }]),
  )
}
