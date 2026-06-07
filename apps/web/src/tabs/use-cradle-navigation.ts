import { useTabNavigation } from '@cradle/tabs-next'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { prefetchChatSession } from '~/features/chat/session/chat-session-prefetch'


import { useCradleTabStore } from '~/tabs/registry'

export function useCradleNavigation() {
  const { navigateInTab, openInNewTab } = useTabNavigation()
  const queryClient = useQueryClient()

  const prefetchTarget = useCallback((type: string, params?: Record<string, string | undefined>) => {
    if (type === 'chat' && params?.sessionId) {
      prefetchChatSession(queryClient, params.sessionId)
    }
  }, [queryClient])

  /** Navigate in the current tab unless the target already exists in the app tab list. */
  const openTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    prefetchTarget(type, params)
    return navigateInTab(type, params)
  }, [navigateInTab, prefetchTarget])

  /** Always open a new tab. */
  const openNewTab = useCallback((type: string, params?: Record<string, string | undefined>) => {
    prefetchTarget(type, params)
    return openInNewTab(type, params)
  }, [openInNewTab, prefetchTarget])

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
