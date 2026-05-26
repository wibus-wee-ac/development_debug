import { describe, expect, it } from 'vitest'

import { chooseMountedTabIds } from '../renderer-policy'
import type { TabContextState, TabInstance } from '../types'

function tab(id: string, pinned = false): TabInstance {
  return { id, type: id, params: {}, label: id, pinned }
}

function context(id: string, lastActiveAt: number, keepAlive: TabContextState['keepAlive'] = 'default'): TabContextState {
  return {
    id,
    history: [{ location: { routeId: id, params: {}, pathname: `/${id}` } }],
    index: 0,
    pinned: false,
    keepAlive,
    createdAt: lastActiveAt,
    lastActiveAt,
    viewState: {},
  }
}

describe('chooseMountedTabIds', () => {
  it('renders only the active tab for single policy', () => {
    expect(chooseMountedTabIds(
      [tab('home'), tab('chat')],
      [context('home', 1), context('chat', 2)],
      'chat',
      { strategy: 'single' },
    )).toEqual(['chat'])
  })

  it('keeps active, pinned, and recent tabs within the Activity pool limit', () => {
    expect(chooseMountedTabIds(
      [tab('home', true), tab('a'), tab('b'), tab('c')],
      [context('home', 1), context('a', 10), context('b', 30), context('c', 20)],
      'a',
      { strategy: 'activity-pool', maxMountedTabs: 3, keepPinnedMounted: true },
    )).toEqual(['home', 'a', 'b'])
  })
})
