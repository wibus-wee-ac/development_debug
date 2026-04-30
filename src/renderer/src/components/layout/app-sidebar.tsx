// Input: WorkspaceSidebar, SettingsSidebar, KanbanSidebar, layout store, useShortcut, motion/react, tab store
// Output: AppSidebar — persistent collapsible sidebar with drill-in navigation
// Position: Rendered at app root; persists across tab changes

import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { KanbanSidebar } from '@renderer/features/kanban/kanban-sidebar'
import { SettingsSidebar } from '@renderer/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { useLayoutStore } from '@renderer/store/layout'
import { useCradleTabStore } from '@renderer/tabs/registry'
import { AnimatePresence, motion } from 'motion/react'

const DRILL_TRANSITION = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.8,
} as const

const SIDEBAR_SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const COLLAPSED_WIDTH = 48
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400

export function AppSidebar() {
  'use no memo'
  const {
    sidebarWidth,
    setSidebarWidth,
    sidebarCollapsed,
    toggleSidebar,
    isSettings,
    settingsSection,
    openSettings,
    closeSettings,
    setSettingsSection,
  } = useLayoutStore()
  const activeTabType = useCradleTabStore(s => s.tabs.find(t => t.id === s.activeTabId)?.type)
  const isKanban = activeTabType === 'kanban-board'

  useShortcut('toggle-settings', { meta: true, key: ',' }, isSettings ? closeSettings : openSettings)
  useShortcut('exit-settings', { key: 'Escape' }, closeSettings, isSettings)
  useShortcut('toggle-sidebar', { meta: true, key: 'b' }, toggleSidebar)

  const sidebarMode: 'settings' | 'kanban' | 'main' = isSettings ? 'settings' : isKanban ? 'kanban' : 'main'
  const isDrillIn = sidebarMode !== 'main'
  // Drill-in modes force sidebar open; only main mode respects user's collapse preference
  const collapsed = sidebarCollapsed && !isDrillIn
  const currentWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth

  return (
    <>
      <motion.aside
        className="flex flex-col shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden"
        animate={{ width: currentWidth }}
        transition={SIDEBAR_SPRING}
        style={{ width: currentWidth }}
      >
        {/* Traffic light spacer — drag region matching AppHeader height */}
        <div className="h-9.5 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div
          className="relative flex flex-col flex-1 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {sidebarMode === 'settings'
              ? (
                <motion.div
                  key="settings-nav"
                  className="flex flex-1 flex-col overflow-hidden"
                  initial={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                  animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                  transition={DRILL_TRANSITION}
                >
                  <SettingsSidebar
                    activeSection={settingsSection}
                    onSetSection={setSettingsSection}
                    onClose={closeSettings}
                  />
                </motion.div>
              )
              : sidebarMode === 'kanban'
                ? (
                  <motion.div
                    key="kanban-nav"
                    className="flex flex-1 flex-col overflow-hidden"
                    initial={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                    animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ x: 20, opacity: 0, filter: 'blur(4px)' }}
                    transition={DRILL_TRANSITION}
                  >
                    <KanbanSidebar />
                  </motion.div>
                )
                : (
                  <motion.div
                    key="main-nav"
                    className="flex flex-1 flex-col overflow-hidden"
                    initial={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                    animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                    exit={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                    transition={DRILL_TRANSITION}
                  >
                    <WorkspaceSidebar collapsed={collapsed} />
                  </motion.div>
                )}
          </AnimatePresence>
        </div>
      </motion.aside>
      {!collapsed && (
        <ResizeHandle
          direction="horizontal"
          value={sidebarWidth}
          onChange={setSidebarWidth}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          className="bg-sidebar"
        />
      )}
    </>
  )
}
