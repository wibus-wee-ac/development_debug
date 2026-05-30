import './styles.css'

import { createUrlSync, TabRenderer, TabsProvider } from '@cradle/tabs-next'
import { useCallback, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { AppEnvironmentProviders, useThemeClass } from '~/app-providers'
import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar } from '~/components/layout/app-sidebar'
import { LayoutSlotsProvider } from '~/components/layout/layout-slots-context'
import { useDesktopTrayActionBridge } from '~/features/desktop-tray/use-desktop-tray-action-bridge'
import { GlobalSearchDialog } from '~/features/search/global-search-dialog'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { SettingsContent } from '~/features/settings/settings-content'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { cn } from '~/lib/cn'
import { CHAT_TAB_FALLBACK_LABEL, isGeneratedChatLabel } from '~/tabs/chat.tab'
import { cradleRegistry, useCradleTabStore } from '~/tabs/registry'
import { preloadCradleTabRoutes } from '~/tabs/route-preload'
import { installTearoffSessionRestore } from '~/tabs/tearoff-tabs'

function getActiveLayoutSlotId(tab: { type: string, params: Record<string, string | undefined> } | undefined): string | null {
  if (!tab) {
    return null
  }
  if (tab.type === 'chat') {
    return tab.params.sessionId ?? null
  }
  if (tab.type === 'workspace-detail') {
    return tab.params.workspaceId ? `workspace-detail:${tab.params.workspaceId}` : null
  }
  if (tab.type === 'new-chat') {
    return 'new-chat'
  }
  return null
}

export function App() {
  'use no memo'

  return <MainAppRuntime />
}

function MainAppRuntime() {
  'use no memo'

  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const settingsSection = useSettingsOverlayStore(s => s.settingsSection)
  const closeSettings = useSettingsOverlayStore(s => s.closeSettings)

  const activeSlotId = useCradleTabStore((s) => {
    const activeTab = s.tabs.find(tab => tab.id === s.activeTabId)
    return getActiveLayoutSlotId(activeTab)
  })
  const validSlotIds = useCradleTabStore(useShallow(s => (
    s.tabs.map(getActiveLayoutSlotId).filter((id): id is string => id !== null)
  )))
  const settingsTabExists = useCradleTabStore(s => (
    settingsTabId !== null && s.tabs.some(tab => tab.id === settingsTabId)
  ))

  // Settings overlay is visible when the settings tab is the currently active tab
  const isSettingsVisible = useCradleTabStore(s => (
    settingsTabId !== null
    && settingsTabExists
    && s.activeTabId === settingsTabId
  ))

  const openGlobalSearch = useCallback(() => {
    useGlobalSearchStore.getState().openSearch()
  }, [])

  useThemeClass()

  useDesktopTrayActionBridge({ onOpenGlobalSearch: openGlobalSearch })

  useEffect(() => {
    queueMicrotask(preloadCradleTabRoutes)
  }, [])

  useEffect(() => installTearoffSessionRestore(useCradleTabStore), [])

  useEffect(() => {
    if (settingsTabId !== null && !settingsTabExists) {
      closeSettings()
    }
  }, [closeSettings, settingsTabExists, settingsTabId])

  // Ensure at least one home tab exists on startup (fresh or cleared state)
  useEffect(() => {
    const { tabs, openTab, updateTabLabel } = useCradleTabStore.getState()
    const homeTabs = tabs.filter(t => t.type === 'home')
    if (homeTabs.length === 0) {
      openTab('home', {}, { pinned: true })
    }
 else if (homeTabs.length > 1) {
      // Clean up duplicate pinned home tabs (persist migration)
      for (const dup of homeTabs.slice(1)) {
        useCradleTabStore.setState(s => ({
          tabs: s.tabs.filter(t => t.id !== dup.id),
          activeTabId: s.activeTabId === dup.id ? homeTabs[0].id : s.activeTabId,
        }))
      }
    }

    for (const tab of tabs) {
      const sessionId = tab.params.sessionId
      if (
        tab.type === 'chat'
        && typeof sessionId === 'string'
        && isGeneratedChatLabel(tab.label, sessionId)
      ) {
        updateTabLabel(tab.id, CHAT_TAB_FALLBACK_LABEL)
      }
    }
  }, [])

  // Initialize URL ↔ Tab Store sync (hash-based routing)
  useEffect(() => {
    const urlSync = createUrlSync({ store: useCradleTabStore, registry: cradleRegistry })
    urlSync.init()
    return () => urlSync.destroy()
  }, [])

  return (
    <AppEnvironmentProviders>
      <LayoutSlotsProvider activeSlotId={activeSlotId} validSlotIds={validSlotIds}>
        <TabsProvider store={useCradleTabStore} registry={cradleRegistry}>
          <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
            <AppSidebar />
            <AppLayout>
              <div className="relative h-full w-full overflow-hidden">
                <div
                  className={cn(
                    'h-full w-full overflow-hidden',
                    isSettingsVisible && 'invisible pointer-events-none',
                  )}
                  aria-hidden={isSettingsVisible ? 'true' : undefined}
                >
                  <TabRenderer
                    fallback={null}
                    className="h-full flex overflow-hidden w-full"
                  />
                </div>
                {isSettingsVisible && (
                  <div
                    className="absolute inset-0 min-w-0 overflow-hidden bg-background z-10"
                    data-testid="settings-tab-overlay"
                    onKeyDownCapture={(event) => {
                      if (
                        event.key === 'Escape'
                        && event.metaKey
                        && !event.ctrlKey
                        && !event.altKey
                      ) {
                        event.preventDefault()
                        closeSettings()
                      }
                    }}
                  >
                    <SettingsContent section={settingsSection} />
                  </div>
                )}
                <GlobalCommandPaletteHost />
              </div>
            </AppLayout>
          </div>
        </TabsProvider>
      </LayoutSlotsProvider>
    </AppEnvironmentProviders>
  )
}

function GlobalCommandPaletteHost() {
  'use no memo'

  const open = useGlobalSearchStore(s => s.open)
  const initialQuery = useGlobalSearchStore(s => s.initialQuery)
  const setOpen = useGlobalSearchStore(s => s.setOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const isMod = event.metaKey || event.ctrlKey
      if (!isMod || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        useGlobalSearchStore.getState().openPalette('>')
        return
      }

      if (key === 'p') {
        event.preventDefault()
        useGlobalSearchStore.getState().openPalette(event.shiftKey ? '>' : '')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return <GlobalSearchDialog open={open} initialQuery={initialQuery} onOpenChange={setOpen} />
}
