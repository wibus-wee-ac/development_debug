// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Link } from '../components/tab-link'
import { TabsProvider } from '../provider'
import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

function DummyComponent() {
  return null
}

const registry = {
  chat: defineTab({
    type: 'chat' as const,
    label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
    serialize: params => params.sessionId ?? '',
    deserialize: path => ({ sessionId: path }),
    component: DummyComponent,
  }),
  usage: defineTab({
    type: 'usage' as const,
    label: 'Usage',
    component: DummyComponent,
  }),
}

function createStore() {
  return createTabStore(registry, { persistKey: `tabs-next-link-test-${Math.random()}` })
}

function renderLink(children: ReactNode, store = createStore()) {
  const view = render(
    <TabsProvider store={store} registry={registry}>
      {children}
    </TabsProvider>,
  )
  return { store, ...view }
}

describe('link', () => {
  it('renders a browser-readable href from the route registry and params', () => {
    renderLink(<Link to="chat" params={{ sessionId: 'one' }}>Open chat</Link>)

    expect(screen.getByRole('link', { name: 'Open chat' }).getAttribute('href')).toBe('#/chat/one')
  })

  it('routes absent primary-click targets through the active tab and prevents browser navigation', () => {
    const store = createStore()
    const tabId = store.getState().openTab('chat', { sessionId: 'one' })
    renderLink(<Link to="chat" params={{ sessionId: 'two' }}>Open chat</Link>, store)

    const didNotPreventDefault = fireEvent.click(screen.getByRole('link', { name: 'Open chat' }))

    const state = store.getState()
    const context = state.contexts.find(item => item.id === tabId)
    expect(didNotPreventDefault).toBe(false)
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0]).toMatchObject({
      id: tabId,
      type: 'chat',
      params: { sessionId: 'two' },
      label: 'Chat two',
    })
    expect(context?.history).toHaveLength(2)
  })

  it('activates an existing target tab on primary clicks instead of replacing the current tab', () => {
    const store = createStore()
    const firstTabId = store.getState().openTab('chat', { sessionId: 'one' })
    const existingTargetTabId = store.getState().openTab('chat', { sessionId: 'two' })
    store.getState().setActiveTab(firstTabId)
    renderLink(<Link to="chat" params={{ sessionId: 'two' }}>Open chat</Link>, store)

    fireEvent.click(screen.getByRole('link', { name: 'Open chat' }))

    const state = store.getState()
    const firstContext = state.contexts.find(item => item.id === firstTabId)
    expect(state.tabs).toHaveLength(2)
    expect(state.activeTabId).toBe(existingTargetTabId)
    expect(state.tabs.find(tab => tab.id === firstTabId)).toMatchObject({
      type: 'chat',
      params: { sessionId: 'one' },
      label: 'Chat one',
    })
    expect(firstContext?.history).toHaveLength(1)
  })

  it('activates an existing route-only tab on primary clicks', () => {
    const store = createStore()
    const firstTabId = store.getState().openTab('chat', { sessionId: 'one' })
    const existingUsageTabId = store.getState().createTab('usage')
    store.getState().setActiveTab(firstTabId)
    renderLink(<Link to="usage">Open usage</Link>, store)

    fireEvent.click(screen.getByRole('link', { name: 'Open usage' }))

    expect(store.getState().tabs).toHaveLength(2)
    expect(store.getState().activeTabId).toBe(existingUsageTabId)
    expect(store.getState().tabs.find(tab => tab.id === firstTabId)).toMatchObject({
      type: 'chat',
      params: { sessionId: 'one' },
    })
  })

  it('honors a default-prevented click without changing tab state', () => {
    const store = createStore()
    store.getState().openTab('chat', { sessionId: 'one' })
    const onClick = vi.fn((event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
    })
    renderLink(<Link to="chat" params={{ sessionId: 'two' }} onClick={onClick}>Open chat</Link>, store)

    fireEvent.click(screen.getByRole('link', { name: 'Open chat' }))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(store.getState().tabs).toHaveLength(1)
    expect(store.getState().tabs[0]).toMatchObject({
      type: 'chat',
      params: { sessionId: 'one' },
      label: 'Chat one',
    })
  })

  it('opens a new tab for modifier clicks and explicit new-tab links', () => {
    const modifierStore = createStore()
    const firstModifierTabId = modifierStore.getState().openTab('chat', { sessionId: 'one' })
    const existingTargetTabId = modifierStore.getState().openTab('chat', { sessionId: 'two' })
    modifierStore.getState().setActiveTab(firstModifierTabId)
    renderLink(<Link to="chat" params={{ sessionId: 'two' }}>Open chat with modifier</Link>, modifierStore)

    fireEvent.click(screen.getByRole('link', { name: 'Open chat with modifier' }), { metaKey: true })

    expect(modifierStore.getState().tabs).toHaveLength(3)
    expect(modifierStore.getState().activeTabId).not.toBe(firstModifierTabId)
    expect(modifierStore.getState().activeTabId).not.toBe(existingTargetTabId)
    expect(modifierStore.getState().getActiveTab()).toMatchObject({
      type: 'chat',
      params: { sessionId: 'two' },
      label: 'Chat two',
    })

    const explicitStore = createStore()
    const firstExplicitTabId = explicitStore.getState().openTab('chat', { sessionId: 'one' })
    renderLink(<Link to="usage" newTab>Open usage</Link>, explicitStore)

    fireEvent.click(screen.getByRole('link', { name: 'Open usage' }))

    expect(explicitStore.getState().tabs).toHaveLength(2)
    expect(explicitStore.getState().activeTabId).not.toBe(firstExplicitTabId)
    expect(explicitStore.getState().getActiveTab()).toMatchObject({
      type: 'usage',
      params: {},
      label: 'Usage',
    })
  })

  it('opens a new tab from middle-click auxiliary activation', () => {
    const store = createStore()
    const firstTabId = store.getState().openTab('chat', { sessionId: 'one' })
    renderLink(<Link to="chat" params={{ sessionId: 'two' }}>Open chat</Link>, store)

    fireEvent(
      screen.getByRole('link', { name: 'Open chat' }),
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }),
    )

    expect(store.getState().tabs).toHaveLength(2)
    expect(store.getState().activeTabId).not.toBe(firstTabId)
    expect(store.getState().getActiveTab()).toMatchObject({
      type: 'chat',
      params: { sessionId: 'two' },
      label: 'Chat two',
    })
  })
})
