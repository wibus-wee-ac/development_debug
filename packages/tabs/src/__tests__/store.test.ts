// Input: @cradle/tabs store and defineTab
// Output: Tests for tab store core functionality
// Position: Unit tests for the core tab management store

import { createTabStore, defineTab } from '@cradle/tabs'
import { beforeEach, describe, expect, it } from 'vitest'

// ─── Test fixtures ────────────────────────────────────────────────────────────

function DummyComponent({ params: _params }: { params: Record<string, string | undefined> }) {
  return null
}

const testRegistry = {
  home: defineTab({
    type: 'home' as const,
    label: '首页',
    pinned: true,
    component: DummyComponent,
  }),
  chat: defineTab({
    type: 'chat' as const,
    label: (p: { sessionId: string }) => `Chat: ${p.sessionId}`,
    component: DummyComponent,
  }),
  usage: defineTab({
    type: 'usage' as const,
    label: '用量',
    component: DummyComponent,
  }),
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createTabStore', () => {
  let store: ReturnType<typeof createTabStore>

  beforeEach(() => {
    // Use unique persist key per test to avoid cross-contamination
    store = createTabStore(testRegistry, { persistKey: `test-tabs-${Math.random()}` })
  })

  describe('openTab', () => {
    it('adds a tab and makes it active', () => {
      const id = store.getState().openTab('home')
      const state = store.getState()

      expect(state.tabs).toHaveLength(1)
      expect(state.activeTabId).toBe(id)
      expect(state.tabs[0].type).toBe('home')
      expect(state.tabs[0].pinned).toBe(true)
    })

    it('resolves label from registry for static labels', () => {
      store.getState().openTab('home')
      expect(store.getState().tabs[0].label).toBe('首页')
    })

    it('resolves label from registry for function labels', () => {
      store.getState().openTab('chat', { sessionId: 'abc' })
      expect(store.getState().tabs[0].label).toBe('Chat: abc')
    })

    it('allows overriding label', () => {
      store.getState().openTab('chat', { sessionId: 'abc' }, { label: 'My Chat' })
      expect(store.getState().tabs[0].label).toBe('My Chat')
    })

    it('returns unique ids', () => {
      const id1 = store.getState().openTab('home')
      const id2 = store.getState().openTab('usage')
      expect(id1).not.toBe(id2)
    })

    it('switches active tab to newly opened tab', () => {
      store.getState().openTab('home')
      const id2 = store.getState().openTab('usage')
      expect(store.getState().activeTabId).toBe(id2)
    })
  })

  describe('closeTab', () => {
    it('removes a non-pinned tab', () => {
      store.getState().openTab('home')
      const chatId = store.getState().openTab('chat', { sessionId: '1' })
      store.getState().closeTab(chatId)
      expect(store.getState().tabs).toHaveLength(1)
      expect(store.getState().tabs[0].type).toBe('home')
    })

    it('does not remove a pinned tab', () => {
      const _homeId = store.getState().openTab('home')
      store.getState().openTab('usage')
      store.getState().closeTab(_homeId)
      // Home is pinned, should still be there
      expect(store.getState().tabs).toHaveLength(2)
    })

    it('does not remove the last tab', () => {
      const chatId = store.getState().openTab('chat', { sessionId: '1' })
      store.getState().closeTab(chatId)
      // Only one tab, should not be removed
      expect(store.getState().tabs).toHaveLength(1)
    })

    it('activates adjacent tab when closing the active tab', () => {
      store.getState().openTab('home')
      const chatId = store.getState().openTab('chat', { sessionId: '1' })
      const usageId = store.getState().openTab('usage')

      // Active is usage (last opened). Close it.
      store.getState().closeTab(usageId)
      // Should activate chat (the one before usage)
      expect(store.getState().activeTabId).toBe(chatId)
    })

    it('does not change active tab when closing a non-active tab', () => {
      store.getState().openTab('home')
      const chatId = store.getState().openTab('chat', { sessionId: '1' })
      const usageId = store.getState().openTab('usage')

      // Active is usage. Close chat.
      store.getState().closeTab(chatId)
      expect(store.getState().activeTabId).toBe(usageId)
    })
  })

  describe('setActiveTab', () => {
    it('switches to an existing tab', () => {
      const homeId = store.getState().openTab('home')
      store.getState().openTab('usage')

      store.getState().setActiveTab(homeId)
      expect(store.getState().activeTabId).toBe(homeId)
    })

    it('does not change active tab for non-existent id', () => {
      const homeId = store.getState().openTab('home')
      store.getState().setActiveTab('non-existent')
      expect(store.getState().activeTabId).toBe(homeId)
    })
  })

  describe('updateTabParams', () => {
    it('merges new params into existing tab', () => {
      store.getState().openTab('chat', { sessionId: '1' })
      const tabId = store.getState().tabs[0].id
      store.getState().updateTabParams(tabId, { sessionId: '2' })
      expect(store.getState().tabs[0].params.sessionId).toBe('2')
    })

    it('preserves existing params when updating partially', () => {
      store.getState().openTab('chat', { sessionId: '1' })
      const tabId = store.getState().tabs[0].id
      store.getState().updateTabParams(tabId, { extra: 'value' })
      expect(store.getState().tabs[0].params.sessionId).toBe('1')
      expect(store.getState().tabs[0].params.extra).toBe('value')
    })
  })

  describe('updateTabLabel', () => {
    it('changes the label of an existing tab', () => {
      store.getState().openTab('usage')
      const tabId = store.getState().tabs[0].id
      store.getState().updateTabLabel(tabId, 'New Label')
      expect(store.getState().tabs[0].label).toBe('New Label')
    })
  })

  describe('getActiveTab', () => {
    it('returns the active tab instance', () => {
      store.getState().openTab('chat', { sessionId: 'test' })
      const active = store.getState().getActiveTab()
      expect(active).toBeDefined()
      expect(active!.type).toBe('chat')
      expect(active!.params.sessionId).toBe('test')
    })

    it('returns undefined when no tabs exist', () => {
      expect(store.getState().getActiveTab()).toBeUndefined()
    })
  })
})

describe('defineTab', () => {
  it('returns the config as-is (identity function)', () => {
    const config = {
      type: 'test' as const,
      label: 'Test',
      component: DummyComponent,
    }
    const result = defineTab(config)
    expect(result).toBe(config)
  })

  it('preserves pinned default as undefined', () => {
    const result = defineTab({
      type: 'test' as const,
      label: 'Test',
      component: DummyComponent,
    })
    expect(result.pinned).toBeUndefined()
  })
})
