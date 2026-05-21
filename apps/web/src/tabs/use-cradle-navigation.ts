import { useTabNavigation } from '@cradle/tabs-next'
import { useCallback } from 'react'

import { useCradleTabStore } from '~/tabs/registry'

export function useCradleNavigation() {
  const { navigateInTab, openInNewTab } = useTabNavigation()

  /** Navigate in the current tab; pinned tabs fall back to opening or activating another tab. */
  const openTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    return navigateInTab(type, params)
  }, [navigateInTab])

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
