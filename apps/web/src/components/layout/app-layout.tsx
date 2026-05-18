// Input: ResizeHandle, layout store, motion/react, page slot props, DevBottomBar, useGlobalEventListeners, useLayoutSlotsCtx
// Output: AppLayout component — content area layout (header + main + aside + panel)
// Position: Core layout component; sidebar is rendered separately in __root.tsx

import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { DevBottomBar } from '~/components/layout/dev-bottom-bar'
import { LayoutGeometryProvider, useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { RightAside } from '~/components/layout/right-aside'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { BrowserPanel } from '~/features/browser'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { isElectron } from '~/lib/electron'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const

interface AppLayoutProps {
  children?: ReactNode
  /** Show bottom panel toggle in header */
  hasPanel?: boolean
  /** Bottom panel content */
  panel?: ReactNode
}

export function AppLayout({ children, hasPanel, panel }: AppLayoutProps) {
  return (
    <LayoutGeometryProvider>
      <AppLayoutContent hasPanel={hasPanel} panel={panel}>
        {children}
      </AppLayoutContent>
    </LayoutGeometryProvider>
  )
}

function AppLayoutContent({ children, hasPanel, panel }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [mainWidth, setMainWidth] = useState(800)
  const mainRef = useCallback((el: HTMLElement | null) => {
    if (!el) {
      return
    }
    setMainWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setMainWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useGlobalEventListeners()
  const { registerCenterColumn } = useLayoutGeometry()

  // Per-tab layout slots registered by tab content components
  const { slots } = useLayoutSlotsCtx()

  // Slot props override explicit props so per-tab content wins
  const resolvedPanel = slots.panel ?? panel
  const resolvedHasPanel = slots.hasPanel ?? hasPanel
  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const activeTab = useCradleTabStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const activeSessionId = activeTab?.type === 'chat' ? activeTab.params.sessionId ?? null : null
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const jarvisExpanded = useJarvisUiStore(s => s.expanded)

  const {
    asideWidth,
    setAsideWidth,
    asideOpen,
    bottomPanelHeight,
    setBottomPanelHeight,
    bottomPanelOpen,
    browserPanelOpen,
    browserPanelRatio,
    setBrowserPanelRatio,
  } = useLayoutStore()
  const isSettings = settingsTabId !== null && settingsTabId === activeTabId

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* ── Full-width top header — toggle + breadcrumbs ── */}
      <AppHeader
        hasAside={!!activeSessionId}
        hasPanel={resolvedHasPanel}
      />

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Center column */}
        <m.div
          ref={registerCenterColumn}
          data-slot="app-center-column"
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-[var(--shadow-sm)] z-10 m-1 mr-2"
          animate={jarvisExpanded ? { scale: 0.98, y: -7, opacity: 0.6 } : { scale: 1, y: 0, opacity: 1 }}
          transition={SPRING}
        >
          <main ref={mainRef} className="flex flex-row flex-1 bg-background overflow-hidden rounded-xl">
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">
              {children}
            </div>

            {/* Browser panel split — reveal animation */}
            {isElectron && activeTab?.type === 'chat' && (
              <>
                {browserPanelOpen && (
                  <ResizeHandle
                    direction="horizontal"
                    value={browserPanelRatio * mainWidth}
                    onChange={(px) => {
                      setBrowserPanelRatio(Math.max(0.2, Math.min(0.7, px / mainWidth)))
                    }}
                    onDragStart={() => setDragging('browser')}
                    onDragEnd={() => setDragging(null)}
                    min={mainWidth * 0.2}
                    max={mainWidth * 0.7}
                    inverted
                    className="bg-background"
                  />
                )}
                <m.div
                  initial={false}
                  animate={{ flexBasis: browserPanelOpen ? `${browserPanelRatio * 100}%` : '0%' }}
                  transition={dragging === 'browser' ? INSTANT : SPRING}
                  className="overflow-hidden shrink-0 border-l border-border/50 flex flex-col"
                  data-testid="app-layout-browser-panel"
                >
                  <BrowserPanel />
                </m.div>
              </>
            )}
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

        {/* Right Aside — layout-owned, independent of tab lifecycle */}
        {!isSettings && activeSessionId && (
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
                <RightAside sessionId={activeSessionId} />
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
