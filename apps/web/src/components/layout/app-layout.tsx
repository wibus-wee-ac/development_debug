import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { DevBottomBar } from '~/components/layout/dev-bottom-bar'
import {
  LayoutGeometryProvider,
  useLayoutGeometry,
} from '~/components/layout/layout-geometry-context'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { RightAside } from '~/components/layout/right-aside'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { BrowserPanel } from '~/features/browser'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const

type BrowserBridgeCleanup = () => void

function parseBrowserTabRequest(payload: unknown): string | undefined {
  return typeof payload === 'object'
    && payload !== null
    && 'url' in payload
    && typeof payload.url === 'string'
    ? payload.url
    : undefined
}

function installBrowserUseBridge(openBrowserPanel: () => void): BrowserBridgeCleanup {
  const requestBrowserTab = (payload: unknown) => {
    openBrowserPanel()
    useBrowserPanelStore.getState().requestTab(parseBrowserTabRequest(payload))
  }
  const createBrowserTab = (url?: string) => {
    openBrowserPanel()
    return useBrowserPanelStore.getState().createTab(url)
  }
  const activateBrowserTab = (tabId: string) => {
    const state = useBrowserPanelStore.getState()
    if (!state.tabs.some(tab => tab.kind === 'browser' && tab.id === tabId)) {
      return false
    }
    openBrowserPanel()
    state.setActiveTab(tabId)
    return true
  }
  const getActiveBrowserTab = () => {
    const state = useBrowserPanelStore.getState()
    return state.tabs.find(tab => tab.kind === 'browser' && tab.id === state.activeTabId)?.id
  }

  window.__cradleBrowserUseCreateTab = createBrowserTab
  window.__cradleBrowserUseActivateTab = activateBrowserTab
  window.__cradleBrowserUseGetActiveTab = getActiveBrowserTab
  const unsubscribe = window.cradle?.ipc.on('browser-use:create-tab', requestBrowserTab)

  return () => {
    if (window.__cradleBrowserUseCreateTab) {
      delete window.__cradleBrowserUseCreateTab
    }
    if (window.__cradleBrowserUseActivateTab) {
      delete window.__cradleBrowserUseActivateTab
    }
    if (window.__cradleBrowserUseGetActiveTab) {
      delete window.__cradleBrowserUseGetActiveTab
    }
    unsubscribe?.()
  }
}

interface AppLayoutProps {
  children?: ReactNode
  /** Show browser panel toggle in header */
  hasBrowserPanel?: boolean
  /** Show bottom panel toggle in header */
  hasPanel?: boolean
  /** Bottom panel content */
  panel?: ReactNode
  /** Show the main-window footer surface. */
  showFooter?: boolean
}

export function AppLayout({ children, hasBrowserPanel, hasPanel, panel, showFooter = true }: AppLayoutProps) {
  return (
    <LayoutGeometryProvider>
      <AppLayoutContent hasBrowserPanel={hasBrowserPanel} hasPanel={hasPanel} panel={panel} showFooter={showFooter}>
        {children}
      </AppLayoutContent>
    </LayoutGeometryProvider>
  )
}

function AppLayoutContent({ children, hasBrowserPanel, hasPanel, panel, showFooter = true }: AppLayoutProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const mainElementRef = useRef<HTMLElement | null>(null)
  const mainRef = useCallback((el: HTMLElement | null) => {
    mainElementRef.current = el
  }, [])
  const readMainWidth = useCallback(() => {
    return mainElementRef.current?.clientWidth ?? 800
  }, [])

  useGlobalEventListeners()
  const { registerCenterColumn } = useLayoutGeometry()

  // Per-tab layout slots registered by tab content components
  const { slots } = useLayoutSlotsCtx()
  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const activeTab = useCradleTabStore(s => s.tabs.find(t => t.id === s.activeTabId))
  const activeSessionId = activeTab?.type === 'chat' ? (activeTab.params.sessionId ?? null) : null

  // Slot props override explicit props so per-tab content wins
  const resolvedPanel = slots.panel ?? panel
  const resolvedAsideSessionId = slots.asideSessionId ?? activeSessionId
  const resolvedAsideWorkspaceId = slots.asideWorkspaceId ?? null
  const resolvedHasAside = slots.hasAside ?? !!activeSessionId
  const resolvedHasBrowserPanel = slots.hasBrowserPanel ?? hasBrowserPanel
  const resolvedHasPanel = slots.hasPanel ?? hasPanel
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const jarvisExpanded = useJarvisUiStore(s => s.expanded)

  const asideWidth = useLayoutStore(state => state.asideWidth)
  const setAsideWidth = useLayoutStore(state => state.setAsideWidth)
  const asideOpen = useLayoutStore(state => state.asideOpen)
  const bottomPanelHeight = useLayoutStore(state => state.bottomPanelHeight)
  const setBottomPanelHeight = useLayoutStore(state => state.setBottomPanelHeight)
  const bottomPanelOpen = useLayoutStore(state => state.bottomPanelOpen)
  const browserPanelOpen = useLayoutStore(state => state.browserPanelOpen)
  const browserPanelRatio = useLayoutStore(state => state.browserPanelRatio)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const setBrowserPanelRatio = useLayoutStore(state => state.setBrowserPanelRatio)
  const isSettings = settingsTabId !== null && settingsTabId === activeTabId
  const resolvedBrowserPanelOpen = !isSettings && !!resolvedHasBrowserPanel && browserPanelOpen

  useEffect(() => {
    if (!isElectron) {
      return
    }
    return installBrowserUseBridge(() => setBrowserPanelOpen(true))
  }, [setBrowserPanelOpen])

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* ── Full-width top header — toggle + breadcrumbs ── */}
      <AppHeader hasAside={resolvedHasAside} hasBrowserPanel={resolvedHasBrowserPanel} hasPanel={resolvedHasPanel} />

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Center column */}
        <m.div
          ref={registerCenterColumn}
          data-slot="app-center-column"
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-[var(--shadow-sm)] z-10 m-1 mr-2"
          animate={
            jarvisExpanded ? { scale: 0.98, y: -7, opacity: 0.6 } : { scale: 1, y: 0, opacity: 1 }
          }
          transition={SPRING}
        >
          <main
            ref={mainRef}
            className="flex flex-row flex-1 bg-background overflow-hidden rounded-xl"
          >
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">{children}</div>

            {/* Browser panel split */}
            {resolvedBrowserPanelOpen && (
              <ResizeHandle
                direction="horizontal"
                value={() => browserPanelRatio * readMainWidth()}
                onChange={(px) => {
                  setBrowserPanelRatio(Math.max(0.2, Math.min(0.7, px / readMainWidth())))
                }}
                onDragStart={() => setDragging('browser')}
                onDragEnd={() => setDragging(null)}
                min={() => readMainWidth() * 0.2}
                max={() => readMainWidth() * 0.7}
                inverted
                className="bg-background"
              />
            )}
            <div
              className={cn(
                'flex shrink-0 flex-col overflow-hidden',
                resolvedBrowserPanelOpen && 'border-l border-border/50',
              )}
              style={{ flexBasis: resolvedBrowserPanelOpen ? `${browserPanelRatio * 100}%` : '0%' }}
              data-testid="app-layout-browser-panel"
              data-panel-open={resolvedBrowserPanelOpen ? 'true' : 'false'}
            >
              {resolvedBrowserPanelOpen && <BrowserPanel />}
            </div>
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
        {!isSettings && resolvedHasAside && (resolvedAsideSessionId || resolvedAsideWorkspaceId) && (
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
              <div className="flex flex-col flex-1 overflow-hidden" style={{ width: asideWidth }}>
                <RightAside sessionId={resolvedAsideSessionId} workspaceId={resolvedAsideWorkspaceId} />
              </div>
            </m.aside>
          </>
        )}
      </div>

      {/* Footer */}
      {showFooter && <AppFooter />}
      {showFooter && import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}
