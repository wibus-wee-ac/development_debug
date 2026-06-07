import { AnimatePresence, m } from 'motion/react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ChromeSideSheet } from '~/components/layout/chrome-side-sheet'
import { CHROME_COLLAPSED_SIDEBAR_WIDTH } from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { SettingsSidebar } from '~/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '~/features/workspace'
import { useShortcut } from '~/hooks/use-shortcut'
import { useLayoutStore } from '~/store/layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'

const DRILL_TRANSITION = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.8,
} as const

const SIDEBAR_SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 400

interface AppSidebarContentProps {
  isSettings: boolean
  collapsed: boolean
  reserveTopChrome?: boolean
  settingsSection: string
  onSetSettingsSection: (section: string) => void
  onCloseSettings: () => void
}

const AppSidebarContent = memo(({
  isSettings,
  collapsed,
  reserveTopChrome = true,
  settingsSection,
  onSetSettingsSection,
  onCloseSettings,
}: AppSidebarContentProps) => {
  return (
    <>
      {reserveTopChrome && (
        <div className="h-11 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      )}
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
                  onSetSection={onSetSettingsSection}
                  onClose={onCloseSettings}
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
    </>
  )
})
AppSidebarContent.displayName = 'AppSidebarContent'

function useAppSidebarContentController() {
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const settingsSection = useSettingsOverlayStore(s => s.settingsSection)
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const closeSettings = useSettingsOverlayStore(s => s.closeSettings)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const isSettings = useCradleTabStore(s => settingsTabId !== null && s.activeTabId === settingsTabId)

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

  return {
    closeSettings,
    isSettings,
    setSettingsSection,
    settingsSection,
  }
}

export function AppSidebar() {
  'use no memo'
  const sidebarWidth = useLayoutStore(s => s.sidebarWidth)
  const setSidebarWidth = useLayoutStore(s => s.setSidebarWidth)
  const sidebarCollapsed = useLayoutStore(s => s.sidebarCollapsed)
  const toggleSidebar = useLayoutStore(s => s.toggleSidebar)
  const {
    closeSettings,
    isSettings,
    setSettingsSection,
    settingsSection,
  } = useAppSidebarContentController()
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useShortcut('toggle-sidebar', { meta: true, key: 'b' }, toggleSidebar)

  // Settings drill-in forces sidebar open; main mode respects user's collapse preference
  const collapsed = sidebarCollapsed && !isSettings
  const currentWidth = collapsed ? CHROME_COLLAPSED_SIDEBAR_WIDTH : dragWidth ?? sidebarWidth

  const handleSidebarResize = useCallback((width: number) => {
    setDragWidth(width)
  }, [])

  const handleSidebarResizeEnd = useCallback((width: number) => {
    setSidebarWidth(width)
    setDragWidth(null)
  }, [setSidebarWidth])

  return (
    <>
      <m.aside
        className="flex flex-col shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden"
        animate={{ width: currentWidth }}
        transition={dragWidth === null ? SIDEBAR_SPRING : INSTANT}
        style={{ width: currentWidth }}
        data-testid="app-sidebar"
        data-sidebar-mode={isSettings ? 'settings' : 'main'}
        data-sidebar-collapsed={collapsed ? 'true' : 'false'}
      >
        <AppSidebarContent
          isSettings={isSettings}
          collapsed={collapsed}
          settingsSection={settingsSection}
          onSetSettingsSection={setSettingsSection}
          onCloseSettings={closeSettings}
        />
      </m.aside>
      {!collapsed && (
        <ResizeHandle
          direction="horizontal"
          value={sidebarWidth}
          onChange={handleSidebarResize}
          onChangeEnd={handleSidebarResizeEnd}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
          className="bg-sidebar"
        />
      )}
    </>
  )
}

interface AppSidebarSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AppSidebarSheet({ open, onOpenChange }: AppSidebarSheetProps) {
  'use no memo'
  const { t } = useTranslation('chrome')
  const {
    closeSettings,
    isSettings,
    setSettingsSection,
    settingsSection,
  } = useAppSidebarContentController()

  const toggleSidebarSheet = useCallback(() => {
    onOpenChange(!open)
  }, [onOpenChange, open])

  useShortcut('toggle-sidebar', { meta: true, key: 'b' }, toggleSidebarSheet)

  return (
    <ChromeSideSheet
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title={t('chromeSheet.sidebar.title')}
      closeLabel={t('chromeSheet.action.close')}
      className="w-[min(20rem,calc(100vw-2rem))]"
    >
      <AppSidebarContent
        isSettings={isSettings}
        collapsed={false}
        reserveTopChrome={false}
        settingsSection={settingsSection}
        onSetSettingsSection={setSettingsSection}
        onCloseSettings={closeSettings}
      />
    </ChromeSideSheet>
  )
}
