import type { Disposable } from '@cradle/plugin-sdk'
import type { McpServerConfig } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const McpServerConfigSchema = z.object({
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).default({}),
  when: z.function().optional(),
})

type RegisteredMcpServerConfig = z.infer<typeof McpServerConfigSchema>

const registry = new Map<string, RegisteredMcpServerConfig>()

export function addHostMcpServer(config: McpServerConfig): void {
  const registered = McpServerConfigSchema.parse(config)
  registry.set(registered.name, registered)
}

export function registerHostMcpServer(owner: string, config: McpServerConfig): Disposable {
  const registered = McpServerConfigSchema.parse(config)
  const record = registerPluginCapability(owner, 'mcp-server', 'server', config.name, config.name, {
    command: registered.command,
    args: registered.args,
    hasEnv: Object.keys(registered.env).length > 0,
  }, [`mcp.${config.name}`])
  registry.set(registered.name, registered)
  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      registry.delete(config.name)
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function registerPluginMcpServer(owner: string, config: McpServerConfig): Disposable {
  if (registry.has(config.name)) {
    throw new Error(`Duplicate MCP server registration: ${config.name}`)
  }
  return registerHostMcpServer(owner, config)
}

export function removeHostMcpServer(name: string): void {
  registry.delete(name)
}

export function getRegisteredMcpServers(): Record<string, { command: string, args: string[], env: Record<string, string> }> {
  return Object.fromEntries(
    Array.from(registry.entries(), ([name, c]) => [name, { command: c.command, args: c.args, env: c.env }]),
  )
}
