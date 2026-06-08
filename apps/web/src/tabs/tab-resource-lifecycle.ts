import type { NavigateTabOptions, TabInstance, TabLocation, TabStoreState } from '@cradle/tabs-next'
import type { StoreApi, UseBoundStore } from 'zustand'

import { stopTerminalPanelOwners } from '~/features/tui/terminal-panel-cleanup'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

type CradleTabStore = UseBoundStore<StoreApi<TabStoreState>>
type ResourceTab = Pick<TabInstance, 'id' | 'type' | 'params'>
type TerminalPanelStopper = (ownerIds: string[]) => void
type BrowserPanelOwnerReleaser = (ownerIds: string[]) => void

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

export function selectBrowserPanelOwnerIds(tabs: readonly Pick<TabInstance, 'id'>[]): Set<string> {
  return new Set(tabs.map(tab => tab.id))
}

export function selectClosedBrowserPanelOwnerIds(
  previousTabs: readonly Pick<TabInstance, 'id'>[],
  nextTabs: readonly Pick<TabInstance, 'id'>[],
): string[] {
  const nextOwnerIds = selectBrowserPanelOwnerIds(nextTabs)
  return Array.from(selectBrowserPanelOwnerIds(previousTabs)).filter(ownerId => !nextOwnerIds.has(ownerId))
}

function releaseBrowserPanelOwners(ownerIds: string[]): void {
  const browserStore = useBrowserPanelStore.getState()
  const layoutStore = useLayoutStore.getState()
  const browserBridge = window.cradle?.browser

  for (const ownerId of ownerIds) {
    layoutStore.setBrowserPanelOpen(false, ownerId)
    browserStore.removeOwnerState(ownerId)
    void browserBridge?.close({ threadId: ownerId }).catch(() => {})
  }
}

function releaseOwnersByTabChange(
  previousTabs: readonly ResourceTab[],
  nextTabs: readonly ResourceTab[],
  stopOwners: TerminalPanelStopper,
  releaseBrowserOwners: BrowserPanelOwnerReleaser,
): void {
  const closedTerminalOwnerIds = selectClosedTerminalPanelOwnerIds(previousTabs, nextTabs)
  if (closedTerminalOwnerIds.length > 0) {
    stopOwners(closedTerminalOwnerIds)
  }

  const closedBrowserOwnerIds = selectClosedBrowserPanelOwnerIds(previousTabs, nextTabs)
  if (closedBrowserOwnerIds.length > 0) {
    releaseBrowserOwners(closedBrowserOwnerIds)
  }
}

export function installTabResourceLifecycle(
  store: CradleTabStore,
  stopOwners: TerminalPanelStopper = stopTerminalPanelOwners,
  releaseBrowserOwners: BrowserPanelOwnerReleaser = releaseBrowserPanelOwners,
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

      releaseOwnersByTabChange(previousTabs, store.getState().tabs, stopOwners, releaseBrowserOwners)
    },
    navigateTab: (tabId: string, location: TabLocation, options?: NavigateTabOptions) => {
      const previousTabs = store.getState().tabs

      navigateTab(tabId, location, options)

      releaseOwnersByTabChange(previousTabs, store.getState().tabs, stopOwners, releaseBrowserOwners)
    },
  })
}
