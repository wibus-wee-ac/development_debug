// Input: AppSidebar, ResizeHandle, layout store, motion/react, page slot props, DevBottomBar, useGlobalEventListeners, SettingsContent
// Output: AppLayout component — three-column layout shell with sidebar drill-in settings
// Position: Core layout component for main-window routes; accepts slot props from route pages

import { AppSidebar } from '@renderer/components/layout/app-sidebar'
import { DevBottomBar } from '@renderer/components/layout/dev-bottom-bar'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { SettingsContent } from '@renderer/features/settings/settings-content'
import { useGlobalEventListeners } from '@renderer/hooks/use-global-event-listeners'
import { useLayoutStore } from '@renderer/store/layout'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

const SIDEBAR = { min: 160, max: 480 }
const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const

interface AppLayoutProps {
  children?: ReactNode
  header?: ReactNode
  aside?: ReactNode
  panel?: ReactNode
}

export function AppLayout({ children, header, aside, panel }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [isSettings, setIsSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState('appearance')

  useGlobalEventListeners()

  const {
    sidebarWidth,
    setSidebarWidth,
    asideWidth,
    setAsideWidth,
    asideOpen,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelOpen,
  } = useLayoutStore()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Sidebar ─────────────────────────────────── */}
        <AppSidebar
          isSettings={isSettings}
          settingsSection={settingsSection}
          onOpenSettings={() => setIsSettings(true)}
          onCloseSettings={() => setIsSettings(false)}
          onSetSection={setSettingsSection}
        />

        <ResizeHandle
          direction="horizontal"
          value={sidebarWidth}
          onChange={setSidebarWidth}
          onDragStart={() => setDragging('sidebar')}
          onDragEnd={() => setDragging(null)}
          min={SIDEBAR.min}
          max={SIDEBAR.max}
          className="bg-background"
        />

        {/* ── Center column ────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div style={{ display: isSettings ? 'none' : undefined }}>
            {header}
          </div>
          <main className="flex-1 bg-background overflow-hidden">
            {isSettings ? <SettingsContent section={settingsSection} /> : children}
          </main>

          {/* Bottom panel — only renders when not in settings */}
          {!isSettings && bottomPanelOpen && panel !== undefined && (
            <ResizeHandle
              direction="vertical"
              value={bottomPanelHeight}
              onChange={setBottomPanelHeight}
              onDragStart={() => setDragging('panel')}
              onDragEnd={() => setDragging(null)}
              min={PANEL.min}
              max={PANEL.max}
              inverted
              className="bg-background"
            />
          )}
          <AnimatePresence initial={false}>
            {!isSettings && bottomPanelOpen && panel !== undefined && (
              <motion.div
                key="bottom-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: bottomPanelHeight, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={dragging === 'panel' ? INSTANT : SPRING}
                className="bg-background border-t border-border overflow-hidden shrink-0"
              >
                <div style={{ height: bottomPanelHeight }}>{panel}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right Aside — only renders if content is provided AND aside is open ── */}
        <AnimatePresence initial={false}>
          {asideOpen && aside !== undefined && (
            <>
              <ResizeHandle
                direction="horizontal"
                value={asideWidth}
                onChange={setAsideWidth}
                onDragStart={() => setDragging('aside')}
                onDragEnd={() => setDragging(null)}
                min={ASIDE.min}
                max={ASIDE.max}
                inverted
                className="bg-background"
              />
              <motion.aside
                key="aside"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: asideWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={dragging === 'aside' ? INSTANT : SPRING}
                className="flex shrink-0 overflow-hidden border-l border-border bg-background"
              >
                <div className="flex flex-col flex-1 overflow-hidden" style={{ width: asideWidth }}>
                  {aside}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
      {import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}
