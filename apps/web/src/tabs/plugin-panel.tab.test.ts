/**
 * @vitest-environment jsdom
 */

import { buildHash, createTabStore, createUrlSync, parseHash } from '@cradle/tabs-next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pluginPanelTab } from './plugin-panel.tab'

const registry = {
  'plugin-panel': pluginPanelTab,
}

function createStore() {
  return createTabStore(registry, { persistKey: `plugin-panel-tab-test-${Math.random()}` })
}

describe('pluginPanelTab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('serializes route segment and local panel id into a browser-readable hash', () => {
    expect(buildHash(registry, 'plugin-panel', {
      routeSegment: 'system-info',
      localId: 'system-info',
    })).toBe('#/plugin-panel/system-info/system-info')
    expect(parseHash(registry, '#/plugin-panel/system-info/system-info')).toEqual({
      type: 'plugin-panel',
      params: {
        routeSegment: 'system-info',
        localId: 'system-info',
      },
    })
  })

  it('opens a cold URL as a plugin panel tab with its route key preserved', () => {
    window.history.replaceState(null, '', '#/plugin-panel/system-info/system-info')
    const store = createStore()
    const sync = createUrlSync({ store, registry })

    sync.init()

    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().getActiveTab()).toMatchObject({
      type: 'plugin-panel',
      params: {
        routeSegment: 'system-info',
        localId: 'system-info',
      },
    })
    sync.destroy()
  })
})
