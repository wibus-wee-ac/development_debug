import type { TabStoreState } from '@cradle/tabs-next'
import type { StoreApi, UseBoundStore } from 'zustand'

import { subscribeTearoffSessionClosed } from '~/lib/electron'

export interface DetachedTearoffTab {
  sessionId: string
  tabId: string
}

type CradleTabStore = UseBoundStore<StoreApi<TabStoreState>>

function chatSessionIdOf(tab: { type: string, params: Record<string, string | undefined> }): string | null {
  return tab.type === 'chat' && typeof tab.params.sessionId === 'string'
    ? tab.params.sessionId
    : null
}

function selectFallbackActiveTabId(args: {
  tabs: Array<{ id: string }>
  removedTabId: string
  activeTabId: string | null
  removedTabIndex: number
}): string | null {
  const { tabs, removedTabId, activeTabId, removedTabIndex } = args
  if (activeTabId !== removedTabId) {
    return activeTabId
  }
  return tabs[Math.min(removedTabIndex, tabs.length - 1)]?.id ?? tabs[0]?.id ?? null
}

export function detachTearoffSessionTab(store: CradleTabStore, sessionId: string): DetachedTearoffTab | null {
  const state = store.getState()
  const tabIndex = state.tabs.findIndex(tab => chatSessionIdOf(tab) === sessionId)
  const tab = state.tabs[tabIndex]
  if (!tab) {
    return null
  }

  const tabs = state.tabs.filter(item => item.id !== tab.id)
  const contexts = state.contexts.filter(context => context.id !== tab.id)
  store.setState({
    tabs,
    contexts,
    activeTabId: selectFallbackActiveTabId({
      tabs,
      removedTabId: tab.id,
      activeTabId: state.activeTabId,
      removedTabIndex: tabIndex,
    }),
  })

  if (tabs.length === 0) {
    store.getState().openTab('home', {}, { pinned: true })
  }

  return {
    sessionId,
    tabId: tab.id,
  }
}

export function restoreTearoffSessionTab(store: CradleTabStore, sessionId: string): string {
  return store.getState().openTab('chat', { sessionId })
}

export function installTearoffSessionRestore(store: CradleTabStore): () => void {
  return subscribeTearoffSessionClosed((sessionId) => {
    restoreTearoffSessionTab(store, sessionId)
  })
}
