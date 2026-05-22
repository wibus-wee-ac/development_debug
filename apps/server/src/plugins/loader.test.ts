/* Verifies server plugin activation and shutdown cleanup behavior. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it } from 'vitest'
import { activateServerPlugins, deactivateAllPlugins } from './loader'
import { getRegisteredMcpServers } from './mcp-registry'
import { listPluginDescriptors } from './runtime-registry'

let tempPluginsDir: string | undefined

interface PluginPackageOptions {
  contributes?: Record<string, unknown>
  omitContributes?: boolean
  grantedPermissions?: string[]
  provenance?: boolean
  server?: boolean
  web?: boolean
}

async function writePluginPackage(options: PluginPackageOptions = {}): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-loader-'))
  const pluginDir = join(pluginsRoot, 'cleanup-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/loader-cleanup',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: options.server === false ? undefined : 'server.mjs',
        web: options.web === true ? 'web.mjs' : undefined,
        ...(options.omitContributes ? {} : {
          contributes: options.contributes ?? {
            capabilities: [{
              id: 'mcp.loader-cleanup',
              type: 'mcp-server',
              layer: 'server',
              permissions: [],
            }],
            permissions: [],
          },
        }),
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'server.mjs'),
    [
      'export function activate(ctx) {',
      '  ctx.mcp.registerServer({ name: "loader-cleanup", command: "node", args: ["server.mjs"] })',
      '}',
    ].join('\n'),
  )
  if (options.web === true) {
    await writeFile(
      join(pluginDir, 'web.mjs'),
      'export function activate() {}',
    )
  }
  if (options.provenance === true) {
    await writeFile(
      join(pluginDir, 'cradle-marketplace-install.json'),
      JSON.stringify({
        schemaVersion: 1,
        installedAt: '2026-05-21T10:00:00.000Z',
        mode: 'downloaded',
        source: 'github',
        repository: 'wibus-wee/Cradle',
        path: 'plugins/loader-cleanup',
        packageName: '@cradle/loader-cleanup',
        version: '1.0.0',
        channel: 'bundled',
        ref: 'main',
        originalUrl: 'cradle://plugins/install?source=github',
        grantedPermissions: options.grantedPermissions,
      }),
    )
  }
  return pluginsRoot
}

async function writeUnsupportedManifestPackage(): Promise<string> {
  const pluginsRoot = await mkdtemp(join(tmpdir(), 'cradle-plugin-loader-unsupported-'))
  const pluginDir = join(pluginsRoot, 'unsupported-plugin')
  await mkdir(pluginDir, { recursive: true })
  await writeFile(
    join(pluginDir, 'package.json'),
    JSON.stringify({
      name: '@cradle/unsupported-manifest',
      type: 'module',
      version: '1.0.0',
      cradle: {
        apiVersion: '1',
        server: 'server.mjs',
        contributes: {
          capabilities: [],
          permissions: [],
        },
        capabilities: ['legacy-capability'],
        permissions: ['legacy-permission'],
      },
    }),
  )
  await writeFile(
    join(pluginDir, 'server.mjs'),
    'export function activate() {}',
  )
  return pluginsRoot
}

describe('server plugin loader lifecycle', () => {
  afterEach(async () => {
    await deactivateAllPlugins()
    delete process.env.CRADLE_PLUGINS_DIR
    delete process.env.CRADLE_PLUGINS_SOURCE_KIND
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
    delete process.env.CRADLE_MARKETPLACE_PLUGINS_DIR
    delete process.env.CRADLE_PLUGIN_ALLOWED_PERMISSIONS
    delete process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS
    if (tempPluginsDir) {
      await rm(tempPluginsDir, { recursive: true, force: true })
      tempPluginsDir = undefined
    }
  })

  it('disposes plugin registrations when all plugins deactivate', async () => {
    tempPluginsDir = await writePluginPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['mcp-server'])

    await deactivateAllPlugins()

    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('rejects legacy manifest declaration arrays during discovery', async () => {
    tempPluginsDir = await writeUnsupportedManifestPackage()
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === 'invalid:unsupported-plugin')
    expect(descriptor?.layers.server.status).toBe('invalid')
    expect(descriptor?.warnings.join('\n')).toContain(
      'cradle.capabilities is not supported in apiVersion 1; use cradle.contributes.capabilities.',
    )
    expect(descriptor?.warnings.join('\n')).toContain(
      'cradle.permissions is not supported in apiVersion 1; use cradle.contributes.permissions.',
    )
  })

  it('rejects apiVersion 1 manifests without explicit contributes', async () => {
    tempPluginsDir = await writePluginPackage({ omitContributes: true })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'workspaceDev'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === 'invalid:cleanup-plugin')
    expect(descriptor?.layers.server.status).toBe('invalid')
    expect(descriptor?.warnings.join('\n')).toContain('cradle.contributes')
  })

  it('disables external local server plugins when required permissions are not granted', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(descriptor?.layers.server.error).toContain('Missing required plugin permission grants: test.permission')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('activates external local server plugins when required permissions are granted', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS = 'test.permission'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('active')
    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
  })

  it('does not trust Marketplace receipt grants from ordinary external local directories', async () => {
    tempPluginsDir = await writePluginPackage({
      provenance: true,
      grantedPermissions: ['test.permission'],
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance?.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.source.grantedPermissions).toBeUndefined()
    expect(descriptor?.layers.server.status).toBe('disabled')
    expect(descriptor?.layers.server.error).toContain('Missing required plugin permission grants: test.permission')
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('trusts Marketplace receipt grants from the Cradle-owned installed plugin directory', async () => {
    tempPluginsDir = await writePluginPackage({
      provenance: true,
      grantedPermissions: ['test.permission'],
      contributes: {
        capabilities: [{
          id: 'mcp.loader-cleanup',
          type: 'mcp-server',
          layer: 'server',
          permissions: ['test.permission'],
        }],
        permissions: [{
          id: 'test.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_MARKETPLACE_PLUGINS_DIR = tempPluginsDir

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance?.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.source.grantedPermissions).toEqual(['test.permission'])
    expect(descriptor?.layers.server.status).toBe('active')
    expect(getRegisteredMcpServers()).toHaveProperty('loader-cleanup')
  })

  it('fails external local server plugins that register undeclared runtime capabilities', async () => {
    tempPluginsDir = await writePluginPackage({
      contributes: {
        capabilities: [],
        permissions: [],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.server.status).toBe('failed')
    expect(descriptor?.layers.server.error).toContain(
      'Runtime capability mcp-server:loader-cleanup is not declared',
    )
    expect(descriptor?.capabilities).toHaveLength(0)
    expect(getRegisteredMcpServers()).not.toHaveProperty('loader-cleanup')
  })

  it('disables external local web bundles when required permissions are not granted', async () => {
    tempPluginsDir = await writePluginPackage({
      server: false,
      web: true,
      contributes: {
        capabilities: [{
          id: 'panel.loader-cleanup',
          type: 'web-panel',
          layer: 'web',
          permissions: ['web.permission'],
        }],
        permissions: [{
          id: 'web.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    const app = new Elysia()
    await activateServerPlugins(app)

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.web.status).toBe('disabled')
    expect(descriptor?.layers.web.error).toContain('Missing required plugin permission grants: web.permission')

    const response = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(response.status).toBe(404)
  })

  it('serves external local web bundles when required permissions are granted', async () => {
    tempPluginsDir = await writePluginPackage({
      server: false,
      web: true,
      contributes: {
        capabilities: [{
          id: 'panel.loader-cleanup',
          type: 'web-panel',
          layer: 'web',
          permissions: ['web.permission'],
        }],
        permissions: [{
          id: 'web.permission',
          required: true,
        }],
      },
    })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'
    process.env.CRADLE_PLUGIN_ALLOWED_LOADER_CLEANUP_PERMISSIONS = 'web.permission'

    const app = new Elysia()
    await activateServerPlugins(app)

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.layers.web.status).toBe('discovered')

    const response = await app.handle(new Request('http://localhost/api/plugins/loader-cleanup/web.mjs'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('export function activate() {}')
  })

  it('projects Marketplace install receipt provenance into plugin descriptors', async () => {
    tempPluginsDir = await writePluginPackage({ provenance: true })
    process.env.CRADLE_PLUGINS_DIR = tempPluginsDir
    process.env.CRADLE_PLUGINS_SOURCE_KIND = 'externalLocal'

    await activateServerPlugins(new Elysia())

    const descriptor = listPluginDescriptors().find(plugin => plugin.identity === '@cradle/loader-cleanup')
    expect(descriptor?.source.provenance).toMatchObject({
      kind: 'marketplace-install',
      mode: 'downloaded',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/loader-cleanup',
      packageName: '@cradle/loader-cleanup',
      version: '1.0.0',
      ref: 'main',
    })
  })
})
