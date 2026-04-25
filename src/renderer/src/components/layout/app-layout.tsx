// Input: AppSidebar, ResizeHandle, layout store, motion/react, page slot props, DevBottomBar, useGlobalEventListeners, SettingsContent
// Output: AppLayout component — three-column layout shell with collapsible sidebar, unified shell bg
// Position: Core layout component for main-window routes; accepts slot props from route pages

import { AppFooter } from '@renderer/components/layout/app-footer'
import { AppSidebar } from '@renderer/components/layout/app-sidebar'
import { DevBottomBar } from '@renderer/components/layout/dev-bottom-bar'
import { ResizeHandle } from '@renderer/components/layout/resize-handle'
import { SettingsContent } from '@renderer/features/settings/settings-content'
import { useGlobalEventListeners } from '@renderer/hooks/use-global-event-listeners'
import { useLayoutStore } from '@renderer/store/layout'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 40 } as const
const INSTANT = { duration: 0 } as const

interface AppLayoutProps {
  children?: ReactNode
  header?: ReactNode
  aside?: ReactNode
  panel?: ReactNode
  hideSidebar?: boolean
}

export function AppLayout({ children, header, aside, panel, hideSidebar }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [isSettings, setIsSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState('appearance')

  useGlobalEventListeners()

  const {
    asideWidth,
    setAsideWidth,
    asideOpen,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelOpen,
  } = useLayoutStore()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-foreground bg-sidebar">
      {/* ── Full-width top header — traffic lights + toggle + breadcrumbs ── */}
      {header}

      {/* ── Bottom area: sidebar + content ─────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar */}
        {!hideSidebar && (
          <AppSidebar
            isSettings={isSettings}
            settingsSection={settingsSection}
            onOpenSettings={() => setIsSettings(true)}
            onCloseSettings={() => setIsSettings(false)}
            onSetSection={setSettingsSection}
          />
        )}

        {/* Center column */}
        <motion.div
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-sm z-10 m-1 mr-2"
          transition={SPRING}
        >
          {/* Show header in center when sidebar is hidden (e.g. tear-off) */}
          {(hideSidebar && !isSettings) && header}
          <main className="flex-1 bg-background overflow-hidden">
            {isSettings ? <SettingsContent section={settingsSection} /> : children}
          </main>

          {/* Bottom panel resize handle */}
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
          {/* Bottom panel — always mounted to preserve xterm state */}
          {!isSettings && panel !== undefined && (
            <motion.div
              initial={{
                height: bottomPanelOpen ? bottomPanelHeight : 0,
                opacity: bottomPanelOpen ? 1 : 0,
              }}
              animate={{
                height: bottomPanelOpen ? bottomPanelHeight : 0,
                opacity: bottomPanelOpen ? 1 : 0,
              }}
              transition={dragging === 'panel' ? INSTANT : SPRING}
              className="bg-background border-t border-border overflow-hidden shrink-0"
            >
              <div style={{ height: bottomPanelHeight }}>{panel}</div>
            </motion.div>
          )}
        </motion.div>

        {/* Right Aside */}
        {aside !== undefined && (
          <>
            {asideOpen && (
              <ResizeHandle
                direction="horizontal"
                value={asideWidth}
                onChange={setAsideWidth}
                onDragStart={() => setDragging('aside')}
                onDragEnd={() => setDragging(null)}
                min={ASIDE.min}
                max={ASIDE.max}
                inverted
                className="bg-sidebar"
              />
            )}
            <motion.aside
              initial={{
                width: asideOpen ? asideWidth : 0,
                opacity: asideOpen ? 1 : 0,
              }}
              animate={{
                width: asideOpen ? asideWidth : 0,
                opacity: asideOpen ? 1 : 0,
              }}
              transition={dragging === 'aside' ? INSTANT : SPRING}
              className="flex shrink-0 overflow-hidden bg-sidebar"
            >
              <div
                className="flex flex-col flex-1 overflow-hidden"
                style={{ width: asideWidth }}
              >
                {aside}
              </div>
            </motion.aside>
          </>
        )}
      </div>

      {/* Footer */}
      <AppFooter />
      {import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}
