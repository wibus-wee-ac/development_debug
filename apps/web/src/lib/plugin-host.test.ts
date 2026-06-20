import { describe, expect, it } from 'vitest'

import { isWebLayerLoadable } from './plugin-host'

describe('plugin host web layer filtering', () => {
  it('does not load failed web layers', () => {
    expect(isWebLayerLoadable({
      name: '@cradle/system-info',
      version: '1.0.0',
      displayName: 'System Info',
      hasWeb: true,
      layers: {
        web: {
          layer: 'web',
          status: 'failed',
          error: 'Web entry is missing: dist/web.mjs',
        },
      },
    })).toBe(false)
  })

  it('loads discovered web layers', () => {
    expect(isWebLayerLoadable({
      name: '@cradle/system-info',
      version: '1.0.0',
      displayName: 'System Info',
      hasWeb: true,
      layers: {
        web: {
          layer: 'web',
          status: 'discovered',
        },
      },
    })).toBe(true)
  })
})
