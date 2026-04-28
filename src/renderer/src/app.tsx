// Input: global styles, app shell providers, theme store, @cradle/tabs library
// Output: App component — root shell with tab system, sidebar, and providers
// Position: Top-level renderer app component (mounted from main.tsx)

import './styles.css'

import { TabRenderer, TabsProvider } from '@cradle/tabs'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { AppSidebar } from '@renderer/components/layout/app-sidebar'
import { AnchoredToastProvider, ToastProvider } from '@renderer/components/ui/toast'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { SettingsContent } from '@renderer/features/settings/settings-content'
import { ShortcutProvider } from '@renderer/lib/shortcut-provider'
import { useLayoutStore } from '@renderer/store/layout'
import { useThemeStore } from '@renderer/store/theme'
import { cradleRegistry, useCradleTabStore } from '@renderer/tabs/registry'
import { useEffect } from 'react'

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
    } else if (homeTabs.length > 1) {
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
            <TabsProvider store={useCradleTabStore} registry={cradleRegistry}>
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
          </ShortcutProvider>
        </TooltipProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
