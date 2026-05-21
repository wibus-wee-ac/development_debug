// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

function DummyComponent() {
  return null
}

const registry = {
  chat: defineTab({
    type: 'chat' as const,
    label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
    component: DummyComponent,
  }),
  usage: defineTab({
    type: 'usage' as const,
    label: 'Usage',
    component: DummyComponent,
  }),
}

describe('persisted context repair', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('prunes unknown route history entries and syncs the tab label to the restored location', () => {
    const persistKey = 'tabs-next-persisted-context-repair'
    window.localStorage.setItem(persistKey, JSON.stringify({
      state: {
        version: 1,
        activeTabId: 'tab-1',
        tabs: [
          { id: 'tab-1', type: 'chat', params: { sessionId: 'stale' }, label: 'Stale', pinned: false },
        ],
        contexts: [
          {
            id: 'tab-1',
            history: [
              {
                location: { routeId: 'removed-route', params: {}, pathname: '/removed-route' },
                title: 'Removed',
              },
              {
                location: { routeId: 'chat', params: { sessionId: 'restored' }, pathname: '/chat' },
              },
              {
                location: { routeId: 'usage', params: {}, pathname: '/usage' },
                title: 'Usage',
              },
            ],
            index: 1,
            pinned: false,
            keepAlive: 'default',
            createdAt: 1,
            lastActiveAt: 2,
            viewState: {},
          },
        ],
      },
      version: 1,
    }))

    const store = createTabStore(registry, { persistKey })

    expect(store.getState().contexts[0].history.map(entry => entry.location.routeId)).toEqual(['chat', 'usage'])
    expect(store.getState().contexts[0].index).toBe(0)
    expect(store.getState().tabs[0]).toMatchObject({
      id: 'tab-1',
      type: 'chat',
      params: { sessionId: 'restored' },
      label: 'Chat restored',
    })
  })
})
