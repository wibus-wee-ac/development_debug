/* Verifies web plugin activation and disposal behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginDescriptor } from '@cradle/plugin-sdk'
import { activateWebPluginModule, deactivateWebPlugins, isWebLayerLoadable, loadWebPlugins } from './plugin-host'
import { usePluginStore } from './plugin-store'

vi.mock('./electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:21423',
}))

function resetPluginStore(): void {
  usePluginStore.setState({ panels: [], commands: [], webLayerStates: {} })
}

function webPluginDescriptor(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    identity: '@external/web-runtime',
    routeSegment: 'web-runtime',
    name: '@external/web-runtime',
    version: '1.0.0',
    displayName: 'Web Runtime',
    source: {
      kind: 'externalLocal',
      packageDir: '/tmp/web-runtime',
      trusted: true,
    },
    layers: {
      server: { layer: 'server', status: 'skipped' },
      web: { layer: 'web', status: 'discovered', entry: 'web.mjs' },
      desktop: { layer: 'desktop', status: 'skipped' },
    },
    capabilities: [],
    declaredCapabilities: [],
    declaredPermissions: [],
    warnings: [],
    hasWeb: true,
    hasServer: false,
    hasDesktop: false,
    ...overrides,
  }
}

describe('web plugin host lifecycle', () => {
  afterEach(async () => {
    await deactivateWebPlugins()
    resetPluginStore()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('disposes registered panels and commands when web plugins deactivate', async () => {
    const deactivate = vi.fn()

    await activateWebPluginModule('@cradle/web-lifecycle', {
      activate(ctx) {
        ctx.panels.register({
          id: 'panel',
          title: 'Lifecycle Panel',
          component: () => null,
        })
        ctx.commands.register({
          id: 'command',
          title: 'Lifecycle Command',
          execute: vi.fn(),
        })
      },
      deactivate,
    })

    expect(usePluginStore.getState().panels.map(panel => panel.id)).toEqual(['@cradle/web-lifecycle:panel'])
    expect(usePluginStore.getState().commands.map(command => command.id)).toEqual(['@cradle/web-lifecycle:command'])
    expect(usePluginStore.getState().webLayerStates['@cradle/web-lifecycle']?.status).toBe('active')

    await deactivateWebPlugins()

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(usePluginStore.getState().panels).toHaveLength(0)
    expect(usePluginStore.getState().commands).toHaveLength(0)
    expect(usePluginStore.getState().webLayerStates['@cradle/web-lifecycle']?.status).toBe('discovered')
  })

  it('cleans partial registrations when activation fails', async () => {
    await expect(activateWebPluginModule('@cradle/web-failure', {
      activate(ctx) {
        ctx.panels.register({
          id: 'panel',
          title: 'Partial Panel',
          component: () => null,
        })
        throw new Error('activation failed')
      },
    })).rejects.toThrow('activation failed')

    expect(usePluginStore.getState().panels).toHaveLength(0)
    expect(usePluginStore.getState().webLayerStates['@cradle/web-failure']?.status).toBe('failed')
    expect(usePluginStore.getState().webLayerStates['@cradle/web-failure']?.error).toBe('activation failed')
  })

  it('fails external local web plugins that register undeclared runtime capabilities', async () => {
    const descriptor = webPluginDescriptor()

    await expect(activateWebPluginModule('@external/web-runtime', {
      activate(ctx) {
        ctx.panels.register({
          id: 'runtime-panel',
          title: 'Runtime Panel',
          component: () => null,
        })
      },
    }, descriptor)).rejects.toThrow('Runtime capability web-panel:runtime-panel is not declared')

    expect(usePluginStore.getState().panels).toHaveLength(0)
    expect(usePluginStore.getState().webLayerStates['@external/web-runtime']?.status).toBe('failed')
  })

  it('provides a plugin-scoped server route client to web plugins', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetch)
    let routeUrl = ''

    await activateWebPluginModule('@external/web-runtime', {
      async activate(ctx) {
        routeUrl = ctx.routes.url('info?format=json')
        const fetchRoute = ctx.routes.fetch
        await fetchRoute('/info', { method: 'POST' })
      },
    }, webPluginDescriptor())

    expect(routeUrl).toBe('http://127.0.0.1:21423/api/plugins/web-runtime/info?format=json')
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:21423/api/plugins/web-runtime/info', { method: 'POST' })
  })

  it('rejects web plugin route paths that escape the plugin route scope', async () => {
    await expect(activateWebPluginModule('@external/web-runtime', {
      activate(ctx) {
        ctx.routes.url('https://example.com/steal')
      },
    }, webPluginDescriptor())).rejects.toThrow('Plugin route path must be relative')

    await expect(activateWebPluginModule('@external/web-runtime', {
      activate(ctx) {
        ctx.routes.url('../core')
      },
    }, webPluginDescriptor())).rejects.toThrow('Plugin route path must not contain traversal')

    await expect(activateWebPluginModule('@external/web-runtime', {
      activate(ctx) {
        ctx.routes.url('/%2e%2e/core')
      },
    }, webPluginDescriptor())).rejects.toThrow('Plugin route path must not contain traversal')
  })

  it('does not load web plugins disabled by host layer policy', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify([
      {
        identity: '@cradle/web-disabled',
        name: '@cradle/web-disabled',
        version: '1.0.0',
        displayName: 'Web Disabled',
        routeSegment: 'web-disabled',
        hasWeb: true,
        layers: {
          web: {
            layer: 'web',
            status: 'disabled',
            entry: 'web.mjs',
            error: 'Missing required plugin permission grants: web.permission.',
          },
        },
      },
    ])))
    vi.stubGlobal('fetch', fetch)

    await loadWebPlugins()

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:21423/api/plugins')
    expect(usePluginStore.getState().panels).toHaveLength(0)
  })

  it('treats discovered web layers as loadable', () => {
    expect(isWebLayerLoadable({
      name: '@cradle/web-enabled',
      version: '1.0.0',
      displayName: 'Web Enabled',
      hasWeb: true,
      layers: {
        server: { layer: 'server', status: 'skipped' },
        web: { layer: 'web', status: 'discovered', entry: 'web.mjs' },
        desktop: { layer: 'desktop', status: 'skipped' },
      },
    })).toBe(true)
  })
})
