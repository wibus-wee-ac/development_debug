// Input: WorkspaceSidebar, SettingsSidebar, layout store, useShortcut hook, motion/react
// Output: AppSidebar component — collapsible sidebar with spring animation and drill-in navigation
// Position: Internal child of AppLayout; controlled via isSettings prop + callbacks

import { SettingsSidebar } from '@renderer/features/settings/settings-sidebar'
import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { useLayoutStore } from '@renderer/store/layout'
import { SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Dispatch, SetStateAction } from 'react'

const DRILL_TRANSITION = {
  type: 'spring',
  stiffness: 500,
  damping: 35,
  mass: 0.8,
} as const

const SIDEBAR_SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const COLLAPSED_WIDTH = 48

interface AppSidebarProps {
  isSettings: boolean
  settingsSection: string
  onOpenSettings: () => void
  onCloseSettings: () => void
  onSetSection: Dispatch<SetStateAction<string>>
}

export function AppSidebar({
  isSettings,
  settingsSection,
  onOpenSettings,
  onCloseSettings,
  onSetSection,
}: AppSidebarProps) {
  const { sidebarWidth, sidebarCollapsed, toggleSidebar } = useLayoutStore()

  useShortcut('toggle-settings', { meta: true, key: ',' }, isSettings ? onCloseSettings : onOpenSettings)
  useShortcut('exit-settings', { key: 'Escape' }, onCloseSettings, isSettings)
  useShortcut('toggle-sidebar', { meta: true, key: 'b' }, toggleSidebar)

  const collapsed = sidebarCollapsed && !isSettings
  const currentWidth = collapsed ? COLLAPSED_WIDTH : sidebarWidth

  return (
    <motion.aside
      className="flex flex-col shrink-0 bg-sidebar text-sidebar-foreground overflow-hidden"
      animate={{ width: currentWidth }}
      transition={SIDEBAR_SPRING}
      style={{ width: currentWidth }}
    >
      <div
        className="relative flex flex-col flex-1 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {isSettings
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
                  onSetSection={onSetSection}
                  onClose={onCloseSettings}
                />
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
  )
}
