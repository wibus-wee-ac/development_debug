import { describe, expect, it, vi } from 'vitest'

import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

function DummyComponent() {
  return null
}

const registry = {
  home: defineTab({
    type: 'home' as const,
    label: 'Home',
    pinned: true,
    component: DummyComponent,
  }),
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

function createStore() {
  return createTabStore(registry, { persistKey: `tabs-next-test-${Math.random()}` })
}

describe('createTabStore', () => {
  it('creates a tab with a navigation context', () => {
    const store = createStore()
    const id = store.getState().openTab('chat', { sessionId: 'one' })
    const state = store.getState()

    expect(state.activeTabId).toBe(id)
    expect(state.tabs[0]).toMatchObject({
      id,
      type: 'chat',
      label: 'Chat one',
      params: { sessionId: 'one' },
    })
    expect(state.contexts[0].history[0].location).toMatchObject({
      routeId: 'chat',
      params: { sessionId: 'one' },
    })
  })

  it('dedupes parameterized tabs but createTab always opens a fresh context', () => {
    const store = createStore()
    const first = store.getState().openTab('chat', { sessionId: 'one' })
    const second = store.getState().openTab('chat', { sessionId: 'one' })
    const third = store.getState().createTab('chat', { sessionId: 'one' })

    expect(second).toBe(first)
    expect(third).not.toBe(first)
    expect(store.getState().tabs).toHaveLength(2)
  })

  it('switches active tabs without rebuilding retained contexts', () => {
    const store = createStore()
    const first = store.getState().openTab('chat', { sessionId: 'one' })
    const second = store.getState().createTab('usage')
    const contexts = store.getState().contexts

    store.getState().setActiveTab(first)

    expect(store.getState().activeTabId).toBe(first)
    expect(store.getState().contexts).toBe(contexts)

    const state = store.getState()
    store.getState().setActiveTab(first)

    expect(store.getState()).toBe(state)
    expect(store.getState().activeTabId).toBe(first)
    expect(store.getState().contexts).toBe(contexts)
    expect(second).not.toBe(first)
  })

  it('preloads route-owned content on open, activate, and navigate', () => {
    const chatPreload = vi.fn()
    const usagePreload = vi.fn()
    const store = createTabStore({
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: DummyComponent,
        preload: chatPreload,
      }),
      usage: defineTab({
        type: 'usage' as const,
        label: 'Usage',
        component: DummyComponent,
        preload: usagePreload,
      }),
    }, { persistKey: `tabs-next-preload-test-${Math.random()}` })

    const first = store.getState().openTab('chat', { sessionId: 'one' })
    const second = store.getState().createTab('usage', {})
    store.getState().setActiveTab(first)
    store.getState().navigateTab(first, {
      routeId: 'usage',
      params: {},
      pathname: '/usage',
    })

    expect(chatPreload).toHaveBeenCalledWith({ sessionId: 'one' })
    expect(usagePreload).toHaveBeenCalledWith({})
    expect(store.getState().activeTabId).toBe(first)
    expect(second).not.toBe(first)
  })

  it('replaces the active tab location without changing tab identity', () => {
    const store = createStore()
    const id = store.getState().openTab('chat', { sessionId: 'one' })
    store.getState().updateTabParams(id, { sessionId: 'two' })

    const tab = store.getState().tabs[0]
    const context = store.getState().contexts[0]
    expect(tab.id).toBe(id)
    expect(tab.params).toEqual({ sessionId: 'two' })
    expect(context.history).toHaveLength(1)
    expect(context.history[0].location.params).toEqual({ sessionId: 'two' })
  })

  it('supports tab-local push, back, and forward history', () => {
    const store = createStore()
    const id = store.getState().openTab('chat', { sessionId: 'one' })
    store.getState().navigateTab(id, {
      routeId: 'usage',
      params: {},
      pathname: '/usage',
    })

    expect(store.getState().tabs[0].type).toBe('usage')
    expect(store.getState().contexts[0].history).toHaveLength(2)

    store.getState().goBack(id)
    expect(store.getState().tabs[0].type).toBe('chat')
    expect(store.getState().tabs[0].params).toEqual({ sessionId: 'one' })

    store.getState().goForward(id)
    expect(store.getState().tabs[0].type).toBe('usage')
  })

  it('repairs restored active id and drops unknown route types', () => {
    const store = createStore()
    store.getState().restoreTabs({
      activeTabId: 'missing',
      tabs: [
        { id: 'home', type: 'home', params: {}, label: 'Home', pinned: true },
        { id: 'bad', type: 'removed-route', params: {}, label: 'Bad', pinned: false },
        { id: 'chat', type: 'chat', params: { sessionId: 'one' }, label: 'Chat one', pinned: false },
      ],
    })

    expect(store.getState().tabs.map(tab => tab.id)).toEqual(['home', 'chat'])
    expect(store.getState().activeTabId).toBe('chat')
    expect(store.getState().contexts).toHaveLength(2)
  })
})
