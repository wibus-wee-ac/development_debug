import { createTabStore, defineTab } from '@cradle/tabs-next'
import { describe, expect, it, vi } from 'vitest'

import {
  installTerminalPanelTabLifecycle,
  readTerminalPanelOwnerId,
  selectClosedTerminalPanelOwnerIds,
} from './terminal-panel-tab-lifecycle'

function DummyComponent() {
  return null
}

const registry = {
  'home': defineTab({
    type: 'home' as const,
    label: 'Home',
    pinned: true,
    component: DummyComponent,
  }),
  'chat': defineTab({
    type: 'chat' as const,
    label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
    component: DummyComponent,
  }),
  'workspace-detail': defineTab({
    type: 'workspace-detail' as const,
    label: (params: { workspaceId: string }) => `Workspace ${params.workspaceId}`,
    component: DummyComponent,
  }),
}

function createStore() {
  return createTabStore(registry, {
    persistKey: `terminal-panel-tab-lifecycle-test-${Math.random()}`,
    crossWindowSync: false,
  })
}

describe('terminal panel tab lifecycle', () => {
  it('derives terminal panel owners from chat and workspace-detail tabs', () => {
    expect(readTerminalPanelOwnerId({
      type: 'chat',
      params: { sessionId: 'session-1' },
    })).toBe('chat:session-1')

    expect(readTerminalPanelOwnerId({
      type: 'workspace-detail',
      params: { workspaceId: 'workspace-1' },
    })).toBe('workspace:workspace-1')

    expect(readTerminalPanelOwnerId({
      type: 'home',
      params: {},
    })).toBeNull()
  })

  it('selects owners that are no longer represented by an open tab', () => {
    const closedOwnerIds = selectClosedTerminalPanelOwnerIds(
      [
        { type: 'chat', params: { sessionId: 'session-1' } },
        { type: 'workspace-detail', params: { workspaceId: 'workspace-1' } },
      ],
      [
        { type: 'chat', params: { sessionId: 'session-1' } },
      ],
    )

    expect(closedOwnerIds).toEqual(['workspace:workspace-1'])
  })

  it('stops a chat terminal owner when the last matching chat tab closes', () => {
    const store = createStore()
    const stopOwners = vi.fn()
    installTerminalPanelTabLifecycle(store, stopOwners)

    store.getState().openTab('home', {}, { pinned: true })
    const chatId = store.getState().openTab('chat', { sessionId: 'session-1' })

    store.getState().closeTab(chatId)

    expect(stopOwners).toHaveBeenCalledTimes(1)
    expect(stopOwners).toHaveBeenCalledWith(['chat:session-1'])
  })

  it('keeps the terminal owner running while another tab still references it', () => {
    const store = createStore()
    const stopOwners = vi.fn()
    installTerminalPanelTabLifecycle(store, stopOwners)

    store.getState().openTab('home', {}, { pinned: true })
    const firstChatId = store.getState().createTab('chat', { sessionId: 'session-1' })
    const secondChatId = store.getState().createTab('chat', { sessionId: 'session-1' })

    store.getState().closeTab(firstChatId)
    expect(stopOwners).not.toHaveBeenCalled()

    store.getState().closeTab(secondChatId)
    expect(stopOwners).toHaveBeenCalledWith(['chat:session-1'])
  })

  it('stops a workspace terminal owner when tab navigation replaces the owner route', () => {
    const store = createStore()
    const stopOwners = vi.fn()
    installTerminalPanelTabLifecycle(store, stopOwners)

    const workspaceTabId = store.getState().openTab('workspace-detail', { workspaceId: 'workspace-1' })

    store.getState().navigateTab(workspaceTabId, {
      routeId: 'home',
      params: {},
      pathname: '/home',
    })

    expect(stopOwners).toHaveBeenCalledTimes(1)
    expect(stopOwners).toHaveBeenCalledWith(['workspace:workspace-1'])
  })
})
