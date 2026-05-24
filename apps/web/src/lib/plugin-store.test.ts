/**
 * Output: Regression coverage for renderer plugin contribution storage.
 * Input: Web plugin panel registrations with host route segments.
 * Position: Feature-owned tests for plugin store URL route keys.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'

import { usePluginStore } from './plugin-store'

function resetPluginStore(): void {
  usePluginStore.setState({
    panels: [],
    commands: [],
    webLayerStates: {},
  })
}

afterEach(() => {
  resetPluginStore()
})

describe('usePluginStore', () => {
  it('stores route segment and local id for web panel URL keys', () => {
    const dispose = usePluginStore.getState().registerPanel('@cradle/system-info', 'system-info', {
      id: 'system-info',
      title: 'System Info',
      component: () => null,
    })

    expect(usePluginStore.getState().panels).toMatchObject([{
      id: '@cradle/system-info:system-info',
      owner: '@cradle/system-info',
      routeSegment: 'system-info',
      localId: 'system-info',
      title: 'System Info',
    }])

    dispose()

    expect(usePluginStore.getState().panels).toEqual([])
  })
})
