import './styles.css'

import type { TabRenderPolicy } from '@cradle/tabs-next'
import { createUrlSync, TabRenderer, TabsProvider } from '@cradle/tabs-next'
import { domAnimation, LazyMotion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar } from '~/components/layout/app-sidebar'
import { LayoutSlotsProvider } from '~/components/layout/layout-slots-context'
import { AnchoredToastProvider, ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { useDesktopTrayActionBridge } from '~/features/desktop-tray/use-desktop-tray-action-bridge'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { GlobalSearchDialog } from '~/features/search/global-search-dialog'
import { SettingsContent } from '~/features/settings/settings-content'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { cn } from '~/lib/cn'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useThemeStore } from '~/store/theme'
import { CHAT_TAB_FALLBACK_LABEL, isGeneratedChatLabel } from '~/tabs/chat.tab'
import { cradleRegistry, useCradleTabStore } from '~/tabs/registry'

const PERSONAL_WORKSPACE_TAB_POLICY: TabRenderPolicy = {
  strategy: 'activity-pool',
  maxMountedTabs: 15,
  keepPinnedMounted: true,
}

function AppEnvironmentProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <ToastProvider>
        <AnchoredToastProvider>
          <TooltipProvider>
            <ShortcutProvider>
              <DirectoryPickerProvider>
                {children}
              </DirectoryPickerProvider>
            </ShortcutProvider>
          </TooltipProvider>
        </AnchoredToastProvider>
      </ToastProvider>
    </LazyMotion>
  )
}

export function App() {
  'use no memo'

  return <AppRuntime />
}

function AppRuntime() {
  'use no memo'

  const mode = useThemeStore(s => s.mode)
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const settingsSection = useSettingsOverlayStore(s => s.settingsSection)
  const closeSettings = useSettingsOverlayStore(s => s.closeSettings)

  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const tabs = useCradleTabStore(s => s.tabs)
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeSlotId = activeTab?.type === 'chat' ? activeTab.params.sessionId : null
  const settingsTabExists = settingsTabId !== null && tabs.some(tab => tab.id === settingsTabId)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)

  // Settings overlay is visible when the settings tab is the currently active tab
  const isSettingsVisible = settingsTabExists && settingsTabId === activeTabId

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true)
  }, [])

  useDesktopTrayActionBridge({ onOpenGlobalSearch: openGlobalSearch })

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
      if (tab.type === 'chat' && typeof sessionId === 'string' && isGeneratedChatLabel(tab.label, sessionId)) {
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

  useEffect(() => {
    const applyDark = (dark: boolean): void => {
      document.documentElement.classList.toggle('dark', dark)
    }

    if (mode !== 'system') {
      applyDark(mode === 'dark')
      return
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyDark(mq.matches)
    const listener = (e: MediaQueryListEvent): void => applyDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [mode])

  return (
    <AppEnvironmentProviders>
      <LayoutSlotsProvider activeSlotId={activeSlotId}>
        <TabsProvider store={useCradleTabStore} registry={cradleRegistry}>
          <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
            <AppSidebar />
            <AppLayout>
              <div className="relative h-full w-full overflow-hidden">
                <div
                  className={cn('h-full w-full overflow-hidden', isSettingsVisible && 'invisible pointer-events-none')}
                  aria-hidden={isSettingsVisible ? 'true' : undefined}
                >
                  <TabRenderer
                    fallback={null}
                    className="h-full flex overflow-hidden w-full"
                    policy={PERSONAL_WORKSPACE_TAB_POLICY}
                  />
                </div>
                {isSettingsVisible && (
                  <div
                    className="absolute inset-0 bg-background"
                    data-testid="settings-tab-overlay"
                    onKeyDownCapture={(event) => {
                      if (event.key === 'Escape' && event.metaKey && !event.ctrlKey && !event.altKey) {
                        event.preventDefault()
                        closeSettings()
                      }
                    }}
                  >
                    <SettingsContent section={settingsSection} />
                  </div>
                )}
                <GlobalSearchDialog open={globalSearchOpen} onOpenChange={setGlobalSearchOpen} />
              </div>
            </AppLayout>
          </div>
        </TabsProvider>
      </LayoutSlotsProvider>
    </AppEnvironmentProviders>
  )
}
