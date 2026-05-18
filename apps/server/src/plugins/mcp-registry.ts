import type { McpServerConfig } from '@cradle/plugin-sdk/server'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const registry = new Map<string, McpServerConfig>()

export function registerMcpServer(config: McpServerConfig): void {
  registry.set(config.name, config)
}

export function registerPluginMcpServer(owner: string, config: McpServerConfig): void {
  if (registry.has(config.name)) {
    throw new Error(`Duplicate MCP server registration: ${config.name}`)
  }
  registerMcpServer(config)
  registerPluginCapability(owner, 'mcp-server', 'server', config.name, config.name, {
    command: config.command,
    args: config.args,
    hasEnv: !!config.env && Object.keys(config.env).length > 0,
  })
}

export function unregisterMcpServer(name: string): void {
  registry.delete(name)
}

export function unregisterPluginMcpServer(owner: string, name: string): void {
  registry.delete(name)
  unregisterPluginCapability(owner, `${owner}:mcp-server.${name}`)
}

export function getRegisteredMcpServers(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  return Object.fromEntries(
    [...registry.entries()].map(([name, c]) => [name, { command: c.command, args: c.args, env: c.env }]),
  )
}
