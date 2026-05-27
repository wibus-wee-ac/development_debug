/**
 * Output: Regression coverage for tabs-next debug cache repair.
 * Input: Cached tabs-next debug states in localStorage.
 * Position: Devtool tabs diagnostics tests for schema-tolerant startup.
 */

import { DEBUG_STORAGE_KEY } from '@cradle/tabs-next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const metrics = {
  createCount: 0,
  openCount: 0,
  activateCount: 0,
  closeCount: 0,
  navigateCount: 0,
  rendererCommitCount: 0,
  rendererDurationTotal: 0,
  rendererDurationRecent: 0,
}

function cachedStateWithoutActivityIds(): string {
  return JSON.stringify({
    snapshot: {
      tabCount: 1,
      contextCount: 1,
      activeTabId: 'tab-1',
      tabs: [
        { id: 'tab-1', type: 'chat', pinned: false, label: 'Chat' },
      ],
      contexts: [
        { id: 'tab-1', historyLen: 1, index: 0, keepAlive: 'default', viewStateKeys: [] },
      ],
    },
    metrics,
    updatedAt: 1,
  })
}

describe('useTabsDebugStore', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  it('repairs cached debug snapshots that predate activityTabIds', async () => {
    window.localStorage.setItem(DEBUG_STORAGE_KEY, cachedStateWithoutActivityIds())

    const { useTabsDebugStore } = await import('./use-tabs-debug-store')

    expect(useTabsDebugStore.getState().debugState?.snapshot.activityTabIds).toEqual([])
    expect(useTabsDebugStore.getState().connected).toBe(false)
  })

  it('ignores malformed cached debug snapshots during startup', async () => {
    window.localStorage.setItem(DEBUG_STORAGE_KEY, '{bad-json')

    const { useTabsDebugStore } = await import('./use-tabs-debug-store')

    expect(useTabsDebugStore.getState().debugState).toBeNull()
    expect(useTabsDebugStore.getState().connected).toBe(false)
  })
})
