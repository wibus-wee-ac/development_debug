// Input: tabs-next context
// Output: programmatic tab navigation helpers
// Position: Compatibility hook over the route-context store

import { useCallback } from 'react'

import { useTabsContext } from '../context'
import { resolveLocation } from '../route-definition'
import type { NavigateTabOptions, TabParams } from '../types'

interface NavigateInTabOptions extends Pick<NavigateTabOptions, 'replace'> {
  label?: string
}

export function useTabNavigation() {
  const { store, registry } = useTabsContext()

  const navigateTo = useCallback((type: string, params?: TabParams) => {
    return store.getState().openTab(type, params)
  }, [store])

  const openInNewTab = useCallback((type: string, params?: TabParams) => {
    return store.getState().createTab(type, params)
  }, [store])

  const navigateInTab = useCallback((type: string, params?: TabParams, options?: NavigateInTabOptions) => {
    const state = store.getState()
    const activeTabId = state.activeTabId
    const nextParams = params ?? {}
    if (!activeTabId) {
      return state.openTab(type, nextParams, options)
    }
    const activeTab = state.tabs.find(tab => tab.id === activeTabId)
    if (activeTab?.pinned) {
      return state.openTab(type, nextParams, options)
    }
    if (activeTab?.type === type && paramsMatch(activeTab.params, nextParams)) {
      return activeTabId
    }
    const route = registry[type]
    const location = route ? resolveLocation(route, nextParams) : { routeId: type, params: nextParams, pathname: `/${type}` }
    state.navigateTab(activeTabId, location, { replace: options?.replace, title: options?.label })
    return activeTabId
  }, [registry, store])

  return { navigateTo, openInNewTab, navigateInTab }
}

function paramsMatch(a: TabParams, b: TabParams): boolean {
  const keysA = Object.keys(a).filter(k => a[k] !== undefined)
  const keysB = Object.keys(b).filter(k => b[k] !== undefined)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every(k => a[k] === b[k])
}
