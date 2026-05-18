// @vitest-environment jsdom
//
// Input: tabs-next URL sync and jsdom history events
// Output: regression coverage for browser history restoration semantics
// Position: URL projection tests for @cradle/tabs-next

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineTab } from '../route-definition'
import { createTabStore } from '../store'
import { createUrlSync } from '../url-sync'

function DummyComponent() {
  return null
}

const registry = {
  chat: defineTab({
    type: 'chat' as const,
    label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
    component: DummyComponent,
    serialize: params => params.sessionId,
    deserialize: path => ({ sessionId: path }),
  }),
  usage: defineTab({
    type: 'usage' as const,
    label: 'Usage',
    component: DummyComponent,
  }),
}

function createStore() {
  return createTabStore(registry, { persistKey: `tabs-next-url-sync-test-${Math.random()}` })
}

describe('createUrlSync', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps tab label consistent when popstate restores an earlier tab location', () => {
    const store = createStore()
    const tabId = store.getState().openTab('chat', { sessionId: 'one' })
    store.getState().navigateTab(tabId, {
      routeId: 'usage',
      params: {},
      pathname: '/usage',
    })

    const sync = createUrlSync({ store, registry })
    sync.init()
    window.dispatchEvent(new PopStateEvent('popstate', {
      state: { __tabsNext: true, tabId, historyIndex: 0 },
    }))

    expect(store.getState().tabs[0]).toMatchObject({
      id: tabId,
      type: 'chat',
      params: { sessionId: 'one' },
      label: 'Chat one',
    })
    expect(store.getState().contexts[0]).toMatchObject({
      id: tabId,
      index: 0,
    })

    sync.destroy()
  })

  it('removes its popstate listener on destroy', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const store = createStore()
    store.getState().openTab('usage')

    const sync = createUrlSync({ store, registry })
    sync.init()
    sync.destroy()

    const popstateListener = addListener.mock.calls.find(call => call[0] === 'popstate')?.[1]
    expect(popstateListener).toBeTypeOf('function')
    expect(removeListener).toHaveBeenCalledWith('popstate', popstateListener)
  })
})
