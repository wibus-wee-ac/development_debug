// Input: useTabNavigation from @cradle/tabs, useCradleTabStore
// Output: useCradleNavigation hook — wraps tab ops (store is source of truth, no URL sync)
// Position: App-level hook for tab navigation

import { useTabNavigation } from '@cradle/tabs'
import { useCallback } from 'react'

import { useCradleTabStore } from '~/tabs/registry'

export function useCradleNavigation() {
  const { navigateTo, openInNewTab } = useTabNavigation()

  /** Open or activate a tab. */
  const openTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    return navigateTo(type, params)
  }, [navigateTo])

  /** Always open a new tab. */
  const openNewTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    return openInNewTab(type, params)
  }, [openInNewTab])

  return { openTab, openNewTab }
}

/** Reactive check: is the active tab of the given type with matching params? */
export function useIsActiveTab(type: string, params?: Record<string, string | undefined>): boolean {
  return useCradleTabStore((s) => {
    const active = s.tabs.find(t => t.id === s.activeTabId)
    if (!active || active.type !== type) {
      return false
    }
    if (!params) {
      return true
    }
    return Object.keys(params).every(k => active.params[k] === params[k])
  })
}
