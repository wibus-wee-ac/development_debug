// Input: useTabsContext
// Output: useTabNavigation hook with navigateTo, openInNewTab, navigateInTab
// Position: Consumer hook for programmatic tab navigation

import { useCallback } from 'react'

import { useTabsContext } from '../context'

export function useTabNavigation() {
  const { store } = useTabsContext()

  /** Open or activate a tab of the given type. If a matching tab already exists, activate it. */
  const navigateTo = useCallback((type: string, params?: Record<string, string | undefined>) => {
    const { tabs, setActiveTab, openTab } = store.getState()
    const existing = tabs.find(t => t.type === type && shallowEqual(t.params, params ?? {}))
    if (existing) {
      setActiveTab(existing.id)
      return existing.id
    }
    return openTab(type, params)
  }, [store])

  /** Always open a new tab, even if one with the same type+params exists. */
  const openInNewTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    return store.getState().openTab(type, params)
  }, [store])

  /** Navigate the current active tab to a different type+params (replaces in-place). */
  const navigateInTab = useCallback((type: string, params?: Record<string, string | undefined>, options?: { label?: string }) => {
    const { activeTabId, tabs, openTab, closeTab } = store.getState()
    if (!activeTabId) {
      return openTab(type, params, options)
    }

    const activeTab = tabs.find(t => t.id === activeTabId)
    if (activeTab?.pinned) {
      // Don't replace pinned tabs, open new instead
      return openTab(type, params, options)
    }

    // Close current, open new (new one becomes active)
    const newId = openTab(type, params, options)
    closeTab(activeTabId)
    return newId
  }, [store])

  return { navigateTo, openInNewTab, navigateInTab }
}

function shallowEqual(a: Record<string, string | undefined>, b: Record<string, string | undefined>): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every(k => a[k] === b[k])
}
