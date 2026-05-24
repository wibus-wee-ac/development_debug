// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

type BroadcastListener = (event: MessageEvent) => void

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()

  readonly name: string
  onmessage: BroadcastListener | null = null

  constructor(name: string) {
    this.name = name
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>()
    channels.add(this)
    FakeBroadcastChannel.channels.set(name, channels)
  }

  postMessage(message: unknown) {
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) {
        continue
      }
      channel.onmessage?.({ data: message } as MessageEvent)
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

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

describe('cross-window tab sync', () => {
  beforeEach(() => {
    window.localStorage.clear()
    FakeBroadcastChannel.channels.clear()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies tab changes from another store with the same persist key', () => {
    const persistKey = 'tabs-next-cross-window-sync'
    const firstStore = createTabStore(registry, { persistKey })
    const secondStore = createTabStore(registry, { persistKey })

    const firstTabId = firstStore.getState().openTab('chat', { sessionId: 'one' })
    const secondTabId = firstStore.getState().openTab('usage')

    expect(secondStore.getState().tabs).toEqual(firstStore.getState().tabs)
    expect(secondStore.getState().activeTabId).toBe(secondTabId)

    secondStore.getState().setActiveTab(firstTabId)

    expect(firstStore.getState().activeTabId).toBe(firstTabId)
  })

  it('repairs remote storage events before applying them', () => {
    const persistKey = 'tabs-next-storage-event-sync'
    const store = createTabStore(registry, { persistKey })
    const storageValue = JSON.stringify({
      state: {
        version: 1,
        activeTabId: 'tab-1',
        tabs: [
          { id: 'tab-1', type: 'chat', params: { sessionId: 'stale' }, label: 'Stale', pinned: false },
          { id: 'bad', type: 'removed-route', params: {}, label: 'Bad', pinned: false },
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
    })

    window.localStorage.setItem(persistKey, storageValue)
    window.dispatchEvent(new StorageEvent('storage', { key: persistKey, newValue: storageValue }))

    expect(store.getState().tabs).toEqual([
      {
        id: 'tab-1',
        type: 'chat',
        params: { sessionId: 'restored' },
        label: 'Chat restored',
        pinned: false,
      },
    ])
    expect(store.getState().activeTabId).toBe('tab-1')
  })
})
