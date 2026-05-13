// Input: global styles, app shell providers, theme store, @cradle/tabs library
// Output: App component — root shell with tab system, sidebar, and providers
// Position: Top-level web app component (mounted from main.tsx)

import './styles.css'

import { TabRenderer, TabsProvider } from '@cradle/tabs'
import { useEffect } from 'react'

import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar } from '~/components/layout/app-sidebar'
import { LayoutSlotsProvider } from '~/components/layout/layout-slots-context'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { AnchoredToastProvider, ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { SettingsContent } from '~/features/settings/settings-content'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useLayoutStore } from '~/store/layout'
import { useThemeStore } from '~/store/theme'
import { cradleRegistry, useCradleTabStore } from '~/tabs/registry'

/**
 * Syncs the active tab's slot id with the LayoutSlotsProvider.
 * Must be rendered inside LayoutSlotsProvider.
 * Uses 'use no memo' to prevent React Compiler from breaking zustand hooks.
 */
function ActiveSlotSync() {
  'use no memo'
  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const tabs = useCradleTabStore(s => s.tabs)
  const { activate } = useLayoutSlotsCtx()
  const activeTab = tabs.find(t => t.id === activeTabId)
  // For chat tabs, the slot id is params.sessionId
  const slotId = activeTab?.type === 'chat' ? activeTab.params.sessionId : null

  useEffect(() => {
    if (slotId) {
      activate(slotId)
    }
  }, [slotId, activate])

  return null
}

export function App() {
  'use no memo'
  const mode = useThemeStore(s => s.mode)
  const { isSettings, settingsSection } = useLayoutStore()

  // Ensure at least one home tab exists on startup (fresh or cleared state)
  useEffect(() => {
    const { tabs, openTab } = useCradleTabStore.getState()
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
    <ToastProvider>
      <AnchoredToastProvider>
        <TooltipProvider>
          <ShortcutProvider>
            <DirectoryPickerProvider>
              <LayoutSlotsProvider>
              <TabsProvider store={useCradleTabStore} registry={cradleRegistry}>
                <ActiveSlotSync />
                <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
                  <AppSidebar />
                  <AppLayout>
                    {isSettings
                      ? <SettingsContent section={settingsSection} />
                      : (
                        <TabRenderer
                          fallback={null}
                          className="h-full flex overflow-hidden w-full"
                        />
                      )}
                  </AppLayout>
                </div>
              </TabsProvider>
            </LayoutSlotsProvider>
            </DirectoryPickerProvider>
          </ShortcutProvider>
        </TooltipProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
