// Input: ResizeHandle, layout store, motion/react, page slot props, DevBottomBar, useGlobalEventListeners, useLayoutSlotsCtx
// Output: AppLayout component — content area layout (header + main + aside + panel)
// Position: Core layout component; sidebar is rendered separately in __root.tsx

import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { DevBottomBar } from '~/components/layout/dev-bottom-bar'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { useLayoutStore } from '~/store/layout'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const

interface AppLayoutProps {
  children?: ReactNode
  /** Show aside toggle in header */
  hasAside?: boolean
  /** Show bottom panel toggle in header */
  hasPanel?: boolean
  /** Right aside content */
  aside?: ReactNode
  /** Bottom panel content */
  panel?: ReactNode
}

export function AppLayout({ children, hasAside, hasPanel, aside, panel }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)

  useGlobalEventListeners()

  // Per-tab layout slots registered by tab content components
  const { slots } = useLayoutSlotsCtx()

  // Slot props override explicit props so per-tab content wins
  const resolvedAside = slots.aside ?? aside
  const resolvedPanel = slots.panel ?? panel
  const resolvedHasAside = slots.hasAside ?? hasAside
  const resolvedHasPanel = slots.hasPanel ?? hasPanel

  const {
    settingsTabId,
    asideWidth,
    setAsideWidth,
    asideOpen,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelOpen,
    jarvisExpanded,
  } = useLayoutStore()
  const isSettings = settingsTabId !== null

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* ── Full-width top header — toggle + breadcrumbs ── */}
      <AppHeader
        hasAside={resolvedHasAside}
        hasPanel={resolvedHasPanel}
      />

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Center column */}
        <m.div
          data-slot="app-center-column"
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-sm z-10 m-1 mr-2"
          animate={jarvisExpanded ? { scale: 0.98, y: -7, opacity: 0.6 } : { scale: 1, y: 0, opacity: 1 }}
          transition={SPRING}
        >
          <main className="flex flex-col flex-1 bg-background overflow-hidden rounded-xl">
            {children}
          </main>

          {/* Bottom panel resize handle */}
          {!isSettings && bottomPanelOpen && resolvedPanel !== undefined && (
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
          {!isSettings && resolvedPanel !== undefined && (
            <m.div
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
              data-testid="app-layout-bottom-panel"
              data-panel-open={bottomPanelOpen ? 'true' : 'false'}
            >
              <div style={{ height: bottomPanelHeight }}>{resolvedPanel}</div>
            </m.div>
          )}
        </m.div>

        {/* Right Aside */}
        {resolvedAside !== undefined && (
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
            <m.aside
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
              data-testid="app-layout-right-aside"
              data-aside-open={asideOpen ? 'true' : 'false'}
            >
              <div
                className="flex flex-col flex-1 overflow-hidden"
                style={{ width: asideWidth }}
              >
                {resolvedAside}
              </div>
            </m.aside>
          </>
        )}
      </div>

      {/* Footer */}
      <AppFooter />
      {import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}
