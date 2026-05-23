import { describe, expect, it } from 'vitest'

import { defineTab } from '@cradle/tabs-next'
import { createTabStore } from '@cradle/tabs-next'

import { detachTearoffSessionTab, restoreTearoffSessionTab } from './tearoff-tabs'

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
  return createTabStore(registry, {
    persistKey: `tearoff-tabs-test-${Math.random()}`,
    crossWindowSync: false,
  })
}

describe('tearoff tab lifecycle helpers', () => {
  it('detaches a torn-off chat tab from the main tab list and restores it when closed', () => {
    const store = createStore()
    const homeId = store.getState().openTab('home', {}, { pinned: true })
    const chatId = store.getState().openTab('chat', { sessionId: 'session-1' })
    store.getState().openTab('usage')
    store.getState().setActiveTab(chatId)

    const detached = detachTearoffSessionTab(store, 'session-1')

    expect(detached).toEqual({ sessionId: 'session-1', tabId: chatId })
    expect(store.getState().tabs.map(tab => tab.id)).toEqual([homeId, expect.any(String)])
    expect(store.getState().tabs.some(tab => tab.id === chatId)).toBe(false)
    expect(store.getState().contexts.some(context => context.id === chatId)).toBe(false)
    expect(store.getState().activeTabId).not.toBe(chatId)

    const restoredId = restoreTearoffSessionTab(store, 'session-1')

    expect(store.getState().tabs.find(tab => tab.id === restoredId)).toMatchObject({
      type: 'chat',
      params: { sessionId: 'session-1' },
    })
    expect(store.getState().activeTabId).toBe(restoredId)
  })

  it('keeps the main tab bar non-empty when the only tab is torn off', () => {
    const store = createStore()
    store.getState().openTab('chat', { sessionId: 'session-1' })

    detachTearoffSessionTab(store, 'session-1')

    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0]).toMatchObject({
      type: 'home',
      pinned: true,
    })
    expect(store.getState().activeTabId).toBe(store.getState().tabs[0].id)
  })
})
