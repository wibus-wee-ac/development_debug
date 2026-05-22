/* Verifies server plugin context registration and disposal behavior. */

import { afterEach, describe, expect, it } from 'vitest'
import { Elysia } from 'elysia'
import type { Disposable, PluginManifest } from '@cradle/plugin-sdk'
import { CradlePluginPackageJsonSchema } from '@cradle/plugin-sdk/manifest'
import { createServerPluginContext } from './context'
import { getRegisteredMcpServers } from './mcp-registry'
import {
  classifyPluginSource,
  createPluginDescriptor,
  listPluginDescriptors,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
} from './runtime-registry'

function manifest(name: string): PluginManifest {
  const pkg = CradlePluginPackageJsonSchema.parse({
    name,
    version: '1.0.0',
    cradle: {
      apiVersion: '1',
      server: 'src/server.ts',
      contributes: {
        capabilities: [],
        permissions: [],
      },
    },
  })

  return {
    name: pkg.name,
    version: pkg.version,
    packageDir: `/plugins/${name}`,
    cradle: pkg.cradle,
  }
}

function registerDescriptor(pluginManifest: PluginManifest): void {
  registerPluginDescriptor(
    createPluginDescriptor(
      pluginManifest,
      classifyPluginSource(pluginManifest.packageDir, '/plugins'),
    ),
  )
}

describe('server plugin context lifecycle', () => {
  afterEach(() => {
    resetPluginRuntimeRegistry()
  })

  it('skips MCP registration when an async predicate returns false', async () => {
    const pluginManifest = manifest('@cradle/context-async-skip')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest, new Elysia())

    const disposable = await ctx.mcp.registerServer({
      name: 'context-async-skip',
      command: 'node',
      args: ['server.mjs'],
      when: async () => false,
    })

    expect(disposable).toBeUndefined()
    expect(ctx.subscriptions).toHaveLength(1)
    expect(getRegisteredMcpServers()).not.toHaveProperty('context-async-skip')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('does not register an async MCP server after the pending subscription is disposed', async () => {
    const pluginManifest = manifest('@cradle/context-async-dispose')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest, new Elysia())

    let resolvePredicate: (value: boolean) => void = () => {}
    const registration = ctx.mcp.registerServer({
      name: 'context-async-dispose',
      command: 'node',
      args: ['server.mjs'],
      when: () => new Promise<boolean>((resolve) => {
        resolvePredicate = resolve
      }),
    })

    expect(ctx.subscriptions).toHaveLength(1)
    ctx.subscriptions[0]?.dispose()
    resolvePredicate(true)
    await registration

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-async-dispose')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks MCP registrations and removes registry plus capability records on dispose', () => {
    const pluginManifest = manifest('@cradle/context-dispose')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest, new Elysia())

    const disposable = ctx.mcp.registerServer({
      name: 'context-dispose',
      command: 'node',
      args: ['server.mjs'],
    }) as Disposable

    expect(ctx.subscriptions).toEqual([disposable])
    expect(getRegisteredMcpServers()).toHaveProperty('context-dispose')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(1)

    disposable.dispose()

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-dispose')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks skill registrations and removes capability records on dispose', () => {
    const pluginManifest = manifest('@cradle/context-skill')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest, new Elysia())

    const disposable = ctx.skills.register({
      name: 'context-skill',
      description: 'A test skill',
      skillFile: '/tmp/SKILL.md',
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['skill'])

    disposable.dispose()

    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('supports namespace registration APIs without changing capability ownership', () => {
    const pluginManifest = manifest('@cradle/context-namespaces')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest, new Elysia())

    const mcp = ctx.mcp.registerServer({
      name: 'context-namespaces',
      command: 'node',
      args: ['server.mjs'],
    }) as Disposable
    const skill = ctx.skills.register({
      name: 'context-namespaces',
      description: 'A namespaced test skill',
      skillFile: '/tmp/SKILL.md',
    })
    const hook = ctx.hooks.chat.onAfterResponse(async () => {})

    expect(ctx.subscriptions).toEqual([mcp, skill, hook])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual([
      'mcp-server',
      'skill',
      'hook',
    ])

    for (const subscription of [...ctx.subscriptions].reverse()) {
      subscription.dispose()
    }

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-namespaces')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks route registrations and disables handlers on dispose', async () => {
    const pluginManifest = manifest('@cradle/context-route')
    registerDescriptor(pluginManifest)
    const app = new Elysia()
    const ctx = createServerPluginContext(pluginManifest, app)

    const disposable = ctx.routes.register({
      method: 'GET',
      path: '/status',
      handler: () => ({ ok: true }),
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['server-route'])

    const activeResponse = await app.handle(new Request('http://localhost/status'))
    expect(activeResponse.status).toBe(200)
    expect(await activeResponse.json()).toEqual({ ok: true })

    disposable.dispose()

    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)

    const disposedResponse = await app.handle(new Request('http://localhost/status'))
    expect(disposedResponse.status).toBe(410)
    expect(await disposedResponse.json()).toEqual({ error: 'Plugin route disposed.' })
  })
})
