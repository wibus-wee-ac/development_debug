// Output: Bridges Cradle tab close events to bottom-panel terminal owner cleanup.
// Input: Cradle tab store state before and after a close action.
// Position: Owned by tabs; TUI remains the owner of PTY stop semantics.

import type { StoreApi, UseBoundStore } from 'zustand'

import type { NavigateTabOptions, TabInstance, TabLocation, TabStoreState } from '@cradle/tabs-next'

import { stopTerminalPanelOwners } from '~/features/tui/terminal-panel-cleanup'

type CradleTabStore = UseBoundStore<StoreApi<TabStoreState>>
type TerminalPanelStopper = (ownerIds: string[]) => void

const installedStores = new WeakSet<CradleTabStore>()

export function readTerminalPanelOwnerId(tab: Pick<TabInstance, 'type' | 'params'>): string | null {
  if (tab.type === 'chat' && typeof tab.params.sessionId === 'string') {
    return `chat:${tab.params.sessionId}`
  }

  if (tab.type === 'workspace-detail' && typeof tab.params.workspaceId === 'string') {
    return `workspace:${tab.params.workspaceId}`
  }

  return null
}

export function selectTerminalPanelOwnerIds(tabs: readonly Pick<TabInstance, 'type' | 'params'>[]): Set<string> {
  const ownerIds = new Set<string>()

  for (const tab of tabs) {
    const ownerId = readTerminalPanelOwnerId(tab)
    if (ownerId) {
      ownerIds.add(ownerId)
    }
  }

  return ownerIds
}

export function selectClosedTerminalPanelOwnerIds(
  previousTabs: readonly Pick<TabInstance, 'type' | 'params'>[],
  nextTabs: readonly Pick<TabInstance, 'type' | 'params'>[],
): string[] {
  const previousOwnerIds = selectTerminalPanelOwnerIds(previousTabs)
  const nextOwnerIds = selectTerminalPanelOwnerIds(nextTabs)

  return Array.from(previousOwnerIds).filter(ownerId => !nextOwnerIds.has(ownerId))
}

function stopOwnersReleasedByTabChange(
  previousTabs: readonly Pick<TabInstance, 'type' | 'params'>[],
  nextTabs: readonly Pick<TabInstance, 'type' | 'params'>[],
  stopOwners: TerminalPanelStopper,
): void {
  const closedOwnerIds = selectClosedTerminalPanelOwnerIds(previousTabs, nextTabs)
  if (closedOwnerIds.length > 0) {
    stopOwners(closedOwnerIds)
  }
}

export function installTerminalPanelTabLifecycle(
  store: CradleTabStore,
  stopOwners: TerminalPanelStopper = stopTerminalPanelOwners,
): void {
  if (installedStores.has(store)) {
    return
  }
  installedStores.add(store)

  const closeTab = store.getState().closeTab
  const navigateTab = store.getState().navigateTab

  store.setState({
    closeTab: (tabId: string) => {
      const previousTabs = store.getState().tabs

      closeTab(tabId)

      stopOwnersReleasedByTabChange(previousTabs, store.getState().tabs, stopOwners)
    },
    navigateTab: (tabId: string, location: TabLocation, options?: NavigateTabOptions) => {
      const previousTabs = store.getState().tabs

      navigateTab(tabId, location, options)

      stopOwnersReleasedByTabChange(previousTabs, store.getState().tabs, stopOwners)
    },
  })
}
