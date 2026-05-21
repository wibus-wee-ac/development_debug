import { AnimatePresence, m } from 'motion/react'
import { useCallback } from 'react'

import { ResizeHandle } from '~/components/layout/resize-handle'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { SettingsSidebar } from '~/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '~/features/workspace'
import { useShortcut } from '~/hooks/use-shortcut'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'

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
  } = useLayoutStore()
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const settingsSection = useSettingsOverlayStore(s => s.settingsSection)
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const closeSettings = useSettingsOverlayStore(s => s.closeSettings)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const isSettings = settingsTabId !== null && settingsTabId === activeTabId

  const handleToggleSettings = useCallback(() => {
    if (isSettings) {
      closeSettings()
    }
    else {
      const id = useCradleTabStore.getState().activeTabId
      if (id) {
        openSettings(id)
      }
    }
  }, [isSettings, closeSettings, openSettings])

  useShortcut('toggle-settings', { meta: true, key: ',' }, handleToggleSettings)
  useShortcut('exit-settings', { meta: true, key: 'Escape' }, closeSettings, isSettings)
  useShortcut('toggle-sidebar', { meta: true, key: 'b' }, toggleSidebar)

  // Settings drill-in forces sidebar open; main mode respects user's collapse preference
  const collapsed = sidebarCollapsed && !isSettings
  const currentWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth

  return (
    <>
      <m.aside
        className="flex flex-col shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden"
        animate={{ width: currentWidth }}
        transition={SIDEBAR_SPRING}
        style={{ width: currentWidth }}
        data-testid="app-sidebar"
        data-sidebar-mode={isSettings ? 'settings' : 'main'}
        data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      >
        {/* Traffic light spacer — drag region matching AppHeader height */}
        <div className="h-9.5 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
        <div
          className="relative flex flex-col flex-1 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {isSettings
              ? (
                <m.div
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
                </m.div>
              )
              : (
                <m.div
                  key="main-nav"
                  className="flex flex-1 flex-col overflow-hidden"
                  initial={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                  animate={{ x: 0, opacity: 1, filter: 'blur(0px)' }}
                  exit={{ x: -20, opacity: 0, filter: 'blur(4px)' }}
                  transition={DRILL_TRANSITION}
                >
                  <WorkspaceSidebar collapsed={collapsed} />
                </m.div>
              )}
          </AnimatePresence>
        </div>
      </m.aside>
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
