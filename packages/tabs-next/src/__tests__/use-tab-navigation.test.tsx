// @vitest-environment jsdom

import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTabNavigation } from '../hooks/use-tab-navigation'
import { TabsProvider } from '../provider'
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
  return createTabStore(registry, { persistKey: `tabs-next-navigation-test-${Math.random()}` })
}

type NavigationApi = ReturnType<typeof useTabNavigation>

function NavigationProbe({ onReady }: { onReady: (api: NavigationApi) => void }) {
  onReady(useTabNavigation())
  return null
}

function renderNavigationProbe(store: ReturnType<typeof createStore>): NavigationApi {
  let api: NavigationApi | null = null
  render(
    <TabsProvider store={store} registry={registry}>
      <NavigationProbe onReady={(value) => {
        api = value
      }}
      />
    </TabsProvider>,
  )
  if (!api) {
    throw new Error('Navigation probe did not initialize')
  }
  return api
}

describe('useTabNavigation', () => {
  it('navigates inside the active tab and pushes tab-local history', () => {
    const store = createStore()
    const firstId = store.getState().openTab('chat', { sessionId: 'one' })
    const api = renderNavigationProbe(store)

    let returnedId = ''
    act(() => {
      returnedId = api.navigateInTab('chat', { sessionId: 'two' })
    })

    const state = store.getState()
    const context = state.contexts.find(item => item.id === firstId)
    expect(returnedId).toBe(firstId)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      id: firstId,
      type: 'chat',
      params: { sessionId: 'two' },
      label: 'Chat two',
    })
    expect(context?.history).toHaveLength(2)
    expect(context?.index).toBe(1)

    act(() => {
      state.goBack(firstId)
    })

    expect(store.getState().tabs[0]).toMatchObject({
      id: firstId,
      type: 'chat',
      params: { sessionId: 'one' },
      label: 'Chat one',
    })
  })

  it('does not push duplicate history when navigating to the current location', () => {
    const store = createStore()
    const firstId = store.getState().openTab('chat', { sessionId: 'one' })
    const api = renderNavigationProbe(store)

    act(() => {
      api.navigateInTab('chat', { sessionId: 'one' })
    })

    const context = store.getState().contexts.find(item => item.id === firstId)
    expect(store.getState().tabs).toHaveLength(1)
    expect(context?.history).toHaveLength(1)
    expect(context?.index).toBe(0)
  })

  it('falls back to opening or activating a tab when the active tab is pinned', () => {
    const store = createStore()
    const homeId = store.getState().openTab('home')
    const api = renderNavigationProbe(store)

    let returnedId = ''
    act(() => {
      returnedId = api.navigateInTab('chat', { sessionId: 'one' })
    })

    const state = store.getState()
    const homeContext = state.contexts.find(item => item.id === homeId)
    expect(returnedId).not.toBe(homeId)
    expect(state.tabs).toHaveLength(2)
    expect(state.activeTabId).toBe(returnedId)
    expect(state.tabs.find(tab => tab.id === homeId)).toMatchObject({
      type: 'home',
      pinned: true,
    })
    expect(homeContext?.history).toHaveLength(1)
  })

  it('keeps explicit new-tab navigation separate from current-tab navigation', () => {
    const store = createStore()
    const firstId = store.getState().openTab('chat', { sessionId: 'one' })
    const api = renderNavigationProbe(store)

    let secondId = ''
    act(() => {
      secondId = api.openInNewTab('chat', { sessionId: 'two' })
    })

    expect(secondId).not.toBe(firstId)
    expect(store.getState().tabs).toHaveLength(2)
    expect(store.getState().activeTabId).toBe(secondId)
    expect(store.getState().contexts.find(item => item.id === firstId)?.history).toHaveLength(1)
  })
})
