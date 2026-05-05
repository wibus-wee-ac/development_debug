// Input: global styles, app shell providers, theme store, @cradle/tabs library
// Output: App component — root shell with tab system, sidebar, and providers
// Position: Top-level renderer app component (mounted from main.tsx)

import './styles.css'

import { TabRenderer, TabsProvider } from '@cradle/tabs'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { AppSidebar } from '@renderer/components/layout/app-sidebar'
import { LayoutSlotsProvider } from '@renderer/components/layout/layout-slots-context'
import { useLayoutSlotsCtx } from '@renderer/components/layout/use-layout-slots'
import { AnchoredToastProvider, ToastProvider } from '@renderer/components/ui/toast'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { SettingsContent } from '@renderer/features/settings/settings-content'
import { ipc } from '@renderer/lib/ipc'
import { ShortcutProvider } from '@renderer/lib/shortcut-provider'
import { useLayoutStore } from '@renderer/store/layout'
import { useThemeStore } from '@renderer/store/theme'
import { cradleRegistry, useCradleTabStore } from '@renderer/tabs/registry'
import { reconcilePersistedTabs } from '@renderer/tabs/reconcile-persisted-tabs'
import { useEffect } from 'react'

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
    let cancelled = false

    const reconcileTabs = async () => {
      if (!ipc) {
        return
      }

      const current = useCradleTabStore.getState()
      const chatSessionIds = [...new Set(
        current.tabs
          .filter(tab => tab.type === 'chat' && typeof tab.params.sessionId === 'string')
          .map(tab => tab.params.sessionId as string),
      )]
      const workspaceIds = [...new Set(
        current.tabs
          .filter(tab => tab.type === 'workspace-detail' && typeof tab.params.workspaceId === 'string')
          .map(tab => tab.params.workspaceId as string),
      )]

      if (chatSessionIds.length === 0 && workspaceIds.length === 0) {
        return
      }

      const [sessionRows, workspaceRows] = await Promise.all([
        Promise.all(chatSessionIds.map(sessionId => ipc.session.get(sessionId))),
        Promise.all(workspaceIds.map(workspaceId => ipc.workspace.get(workspaceId))),
      ])

      if (cancelled) {
        return
      }

      const next = reconcilePersistedTabs({
        tabs: current.tabs,
        activeTabId: current.activeTabId,
        existingSessionIds: new Set(sessionRows.filter(Boolean).map(session => session!.id)),
        existingWorkspaceIds: new Set(workspaceRows.filter(Boolean).map(workspace => workspace!.id)),
      })

      const changed = next.activeTabId !== current.activeTabId
        || next.tabs.length !== current.tabs.length
        || next.tabs.some((tab, index) => current.tabs[index]?.id !== tab.id)

      if (changed) {
        useCradleTabStore.setState(next)
      }
    }

    void reconcileTabs()

    return () => {
      cancelled = true
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
          </ShortcutProvider>
        </TooltipProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  )
}
