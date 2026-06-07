import { m } from 'motion/react'
import type { ReactNode } from 'react'
import { Activity, memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

import { AppFooter } from '~/components/layout/app-footer'
import { AppHeader } from '~/components/layout/app-header'
import { ChromeSideSheet } from '~/components/layout/chrome-side-sheet'
import { DevBottomBar } from '~/components/layout/dev-bottom-bar'
import { deriveActiveLayoutContract } from '~/components/layout/layout-contract'
import {
  LayoutGeometryProvider,
  useLayoutGeometry,
} from '~/components/layout/layout-geometry-context'
import { CENTER_COLUMN_EXPANDED_SCALE, CENTER_COLUMN_EXPANDED_Y } from '~/components/layout/layout-motion'
import {
  CHROME_CENTER_MIN_WIDTH,
  CHROME_COLLAPSED_SIDEBAR_WIDTH,
  CHROME_RESPONSIVE_GUTTER_WIDTH,
  useViewportWidth,
} from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { RightAside } from '~/components/layout/right-aside'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { BrowserPanel } from '~/features/browser'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import type { BrowserTabSource } from '~/store/browser-panel'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSessionLayoutStore } from '~/store/session-layout'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const
const BROWSER_NATIVE_BOUNDS_SETTLE_MS = 420

type BrowserBridgeCleanup = () => void

const MemoizedRightAside = memo(RightAside)
MemoizedRightAside.displayName = 'MemoizedRightAside'

function parseBrowserTabRequest(payload: unknown): string | undefined {
  return typeof payload === 'object'
    && payload !== null
    && 'url' in payload
    && typeof payload.url === 'string'
    ? payload.url
    : undefined
}

function installBrowserUseBridge({
  ownerId,
  openBrowserPanel,
  closeBrowserPanel,
  readBrowserTabSource: _readBrowserTabSource,
}: {
  ownerId: string | null
  openBrowserPanel: () => void
  closeBrowserPanel: () => void
  readBrowserTabSource: () => BrowserTabSource
}): BrowserBridgeCleanup {
  const resolvedOwnerId = ownerId ?? DEFAULT_BROWSER_PANEL_OWNER_ID
  const requestBrowserTab = (payload: unknown) => {
    openBrowserPanel()
    useBrowserPanelStore.getState().requestTab(parseBrowserTabRequest(payload), undefined, ownerId)
  }
  const createBrowserTab = async (url?: string) => {
    openBrowserPanel()
    const bridge = window.cradle?.browser
    if (!bridge) {
      return useBrowserPanelStore.getState().createTab(url, undefined, ownerId)
    }
    const currentState = await bridge.getState({ threadId: resolvedOwnerId })
    const nextState = currentState.open
      ? await bridge.newTab({
          threadId: resolvedOwnerId,
          url: url ?? 'about:blank',
          activate: true,
        })
      : await bridge.open({ threadId: resolvedOwnerId, initialUrl: url ?? 'about:blank' })
    useBrowserPanelStore.getState().upsertOwnerState(nextState)
    return nextState.activeTabId ?? nextState.tabs.at(-1)?.id ?? ''
  }
  const activateBrowserTab = async (tabId: string) => {
    const bridge = window.cradle?.browser
    if (!bridge) {
      return false
    }
    try {
      openBrowserPanel()
      const nextState = await bridge.selectTab({ threadId: resolvedOwnerId, tabId })
      useBrowserPanelStore.getState().upsertOwnerState(nextState)
      return true
    }
 catch {
      return false
    }
  }
  const getActiveBrowserTab = async () => {
    const bridge = window.cradle?.browser
    if (!bridge) {
      const state = useBrowserPanelStore.getState()
      const ownerState = state.owners[resolvedOwnerId]
      return ownerState?.activeTabId ?? undefined
    }
    const state = await bridge.getState({ threadId: resolvedOwnerId })
    useBrowserPanelStore.getState().upsertOwnerState(state)
    return state.activeTabId ?? undefined
  }
  const hideBrowserPanel = async (tabId?: string) => {
    const bridge = window.cradle?.browser
    if (tabId && bridge) {
      const state = await bridge.getState({ threadId: resolvedOwnerId })
      if (!state.tabs.some(tab => tab.id === tabId)) {
        return false
      }
    }
    closeBrowserPanel()
    if (bridge) {
      await bridge.hide({ threadId: resolvedOwnerId })
    }
    return true
  }

  window.__cradleBrowserUseCreateTab = createBrowserTab
  window.__cradleBrowserUseActivateTab = activateBrowserTab
  window.__cradleBrowserUseGoOffScreen = hideBrowserPanel
  window.__cradleBrowserUseGetActiveTab = getActiveBrowserTab
  const unsubscribeBrowserUse = window.cradle?.ipc.on('browser-use:create-tab', requestBrowserTab)
  const unsubscribeBrowserPanelPopup = window.cradle?.ipc.on(
    'browser-panel:open-url',
    requestBrowserTab,
  )

  return () => {
    if (window.__cradleBrowserUseCreateTab) {
      delete window.__cradleBrowserUseCreateTab
    }
    if (window.__cradleBrowserUseActivateTab) {
      delete window.__cradleBrowserUseActivateTab
    }
    if (window.__cradleBrowserUseGoOffScreen) {
      delete window.__cradleBrowserUseGoOffScreen
    }
    if (window.__cradleBrowserUseGetActiveTab) {
      delete window.__cradleBrowserUseGetActiveTab
    }
    unsubscribeBrowserUse?.()
    unsubscribeBrowserPanelPopup?.()
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
  /** Limit tab chrome actions to the current session window. */
  sessionScoped?: boolean
  /** Show the main-window footer surface. */
  showFooter?: boolean
  /** Render the left sidebar as a transient chrome sheet instead of a docked column. */
  sidebarInSheet?: boolean
  /** Current transient left sidebar sheet presentation state. */
  sidebarSheetOpen?: boolean
  /** Opens the transient left sidebar sheet. */
  onOpenSidebarSheet?: () => void
  /** Toggles the transient left sidebar sheet. */
  onToggleSidebarSheet?: () => void
}

export function AppLayout({
  children,
  hasBrowserPanel,
  hasPanel,
  panel,
  sessionScoped = false,
  showFooter = true,
  sidebarInSheet = false,
  sidebarSheetOpen = false,
  onOpenSidebarSheet,
  onToggleSidebarSheet,
}: AppLayoutProps) {
  return (
    <LayoutGeometryProvider>
      <AppLayoutContent
        hasBrowserPanel={hasBrowserPanel}
        hasPanel={hasPanel}
        panel={panel}
        sessionScoped={sessionScoped}
        showFooter={showFooter}
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={onOpenSidebarSheet}
        onToggleSidebarSheet={onToggleSidebarSheet}
      >
        {children}
      </AppLayoutContent>
    </LayoutGeometryProvider>
  )
}

function AppLayoutContent({
  children,
  hasBrowserPanel,
  hasPanel,
  panel,
  sessionScoped = false,
  showFooter = true,
  sidebarInSheet = false,
  sidebarSheetOpen = false,
  onOpenSidebarSheet,
  onToggleSidebarSheet,
}: AppLayoutProps) {
  const { t } = useTranslation('chrome')
  const [dragging, setDragging] = useState<string | null>(null)
  const [rightAsideSheetOpen, setRightAsideSheetOpen] = useState(false)
  const [browserNativeBoundsPaused, setBrowserNativeBoundsPaused] = useState(false)
  const [browserPanelClosing, setBrowserPanelClosing] = useState(false)
  const [previousBrowserPanelVisible, setPreviousBrowserPanelVisible] = useState(false)
  const mainElementRef = useRef<HTMLElement | null>(null)
  const browserPanelElementRef = useRef<HTMLDivElement | null>(null)
  const browserNativeBoundsResumeTimerRef = useRef<number | null>(null)
  const mainRef = useCallback((el: HTMLElement | null) => {
    mainElementRef.current = el
  }, [])
  const readMainWidth = useCallback(() => {
    return mainElementRef.current?.clientWidth ?? 800
  }, [])
  const updateDragging = useCallback((value: string | null) => {
    setDragging(value)
  }, [])

  useGlobalEventListeners()
  const { registerCenterColumn } = useLayoutGeometry()

  // Per-tab layout slots registered by tab content components
  const { slots } = useLayoutSlotsCtx()
  const activeTab = useCradleTabStore(
    useShallow((s) => {
      const tab = s.tabs.find(t => t.id === s.activeTabId)
      return tab
        ? {
            id: tab.id,
            type: tab.type,
            label: tab.label,
            params: tab.params,
          }
        : undefined
    }),
  )
  const activeSessionId = activeTab?.type === 'chat' ? (activeTab.params.sessionId ?? null) : null
  const activeSessionTitle = activeTab?.type === 'chat' ? activeTab.label : null
  const activeBrowserPanelOwnerId = activeTab?.id ?? null
  const activeSessionLayout = useSessionLayoutStore(state =>
    activeSessionId ? state.sessions[activeSessionId] : undefined)
  const layoutContract = deriveActiveLayoutContract({
    activeTab,
    slots,
    sessionLayout: activeSessionLayout,
    explicitPanel: panel,
    explicitHasBrowserPanel: hasBrowserPanel,
    explicitHasPanel: hasPanel,
  })

  const resolvedPanel = layoutContract.panel
  const resolvedAsideSessionId = layoutContract.asideSessionId
  const resolvedAsideWorkspaceId = layoutContract.asideWorkspaceId
  const resolvedHasAside = layoutContract.hasAside
  const resolvedHasBrowserPanel = layoutContract.hasBrowserPanel
  const resolvedHasPanel = layoutContract.hasPanel
  const resolvedWorkspaceLayout = useSessionLayoutStore(state =>
    resolvedAsideWorkspaceId ? state.workspaces[resolvedAsideWorkspaceId] : undefined)
  const resolvedAsideWorkspacePath
    = resolvedWorkspaceLayout?.workspacePath
      ?? (activeSessionLayout?.workspaceId === resolvedAsideWorkspaceId
      ? activeSessionLayout.workspacePath
      : null)
  const resolvedAsideWorkspaceName = resolvedWorkspaceLayout?.workspaceName ?? null
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const jarvisExpanded = useJarvisUiStore(s => s.expanded)

  const bottomPanelHeight = useLayoutStore(state => state.bottomPanelHeight)
  const setBottomPanelHeight = useLayoutStore(state => state.setBottomPanelHeight)
  const bottomPanelOpen = useLayoutStore(state => state.bottomPanelOpen)
  const sidebarWidth = useLayoutStore(state => state.sidebarWidth)
  const sidebarCollapsed = useLayoutStore(state => state.sidebarCollapsed)
  const asideWidth = useLayoutStore(state => state.asideWidth)
  const browserPanelOpen = useLayoutStore(state =>
    activeBrowserPanelOwnerId
      ? (state.browserPanelOpenByOwnerId[activeBrowserPanelOwnerId] ?? false)
      : false)
  const browserPanelRatio = useLayoutStore(state => state.browserPanelRatio)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const setBrowserPanelRatio = useLayoutStore(state => state.setBrowserPanelRatio)
  const setActiveBrowserPanelOwner = useLayoutStore(state => state.setActiveBrowserPanelOwner)
  const isSettings = settingsTabId !== null && settingsTabId === activeTab?.id
  const canUseRightAside
    = !isSettings && !!resolvedHasAside && (!!resolvedAsideSessionId || !!resolvedAsideWorkspaceId)
  const viewportWidth = useViewportWidth()
  const dockedSidebarWidth = sidebarInSheet
    ? 0
    : sidebarCollapsed
      ? CHROME_COLLAPSED_SIDEBAR_WIDTH
      : sidebarWidth
  const rightAsideInSheet = canUseRightAside
    && viewportWidth < dockedSidebarWidth + asideWidth + CHROME_CENTER_MIN_WIDTH + CHROME_RESPONSIVE_GUTTER_WIDTH
  const resolvedBrowserPanelOpen = !isSettings && !!resolvedHasBrowserPanel && browserPanelOpen
  const browserPanelMounted = isElectron
  const browserPanelVisible = browserPanelMounted && resolvedBrowserPanelOpen
  if (previousBrowserPanelVisible !== browserPanelVisible) {
    setPreviousBrowserPanelVisible(browserPanelVisible)
    setBrowserPanelClosing(browserPanelMounted && previousBrowserPanelVisible && !browserPanelVisible)
  }
  const readBrowserTabSource = useCallback((): BrowserTabSource => {
    return {
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
    }
  }, [activeSessionId, activeSessionTitle])
  const handleCloseLastBrowserPanelTab = useCallback(
    (ownerId: string) => {
      setBrowserPanelOpen(false, ownerId)
    },
    [setBrowserPanelOpen],
  )
  const clearBrowserNativeBoundsResumeTimer = useCallback(() => {
    if (browserNativeBoundsResumeTimerRef.current === null) {
      return
    }
    window.clearTimeout(browserNativeBoundsResumeTimerRef.current)
    browserNativeBoundsResumeTimerRef.current = null
  }, [])
  const pauseBrowserNativeBounds = useCallback(() => {
    if (!browserPanelVisible) {
      return
    }
    clearBrowserNativeBoundsResumeTimer()
    setBrowserNativeBoundsPaused(true)
  }, [browserPanelVisible, clearBrowserNativeBoundsResumeTimer])
  const resumeBrowserNativeBounds = useCallback(() => {
    clearBrowserNativeBoundsResumeTimer()
    setBrowserNativeBoundsPaused(false)
  }, [clearBrowserNativeBoundsResumeTimer])
  const pauseBrowserNativeBoundsForLayout = useCallback((force = false) => {
    if (!force && !browserPanelVisible) {
      return
    }
    clearBrowserNativeBoundsResumeTimer()
    setBrowserNativeBoundsPaused(true)
    browserNativeBoundsResumeTimerRef.current = window.setTimeout(() => {
      browserNativeBoundsResumeTimerRef.current = null
      setBrowserNativeBoundsPaused(false)
    }, BROWSER_NATIVE_BOUNDS_SETTLE_MS)
  }, [browserPanelVisible, clearBrowserNativeBoundsResumeTimer])
  const handleBrowserPanelResize = useCallback((px: number) => {
    const panel = browserPanelElementRef.current
    if (panel) {
      panel.style.width = `${px}px`
    }
  }, [])
  const handleBrowserPanelResizeEnd = useCallback(
    (px: number) => {
      const mainWidth = readMainWidth()
      const ratio = Math.max(0.2, Math.min(0.7, px / mainWidth))
      const panel = browserPanelElementRef.current
      if (panel) {
        panel.style.width = `${ratio * 100}%`
      }
      setBrowserPanelRatio(ratio)
      updateDragging(null)
    },
    [readMainWidth, setBrowserPanelRatio, updateDragging],
  )
  const handleBrowserPanelDragStart = useCallback(() => {
    updateDragging('browser')
  }, [updateDragging])
  const handleBottomPanelDragStart = useCallback(() => {
    updateDragging('panel')
    pauseBrowserNativeBounds()
  }, [pauseBrowserNativeBounds, updateDragging])
  const handleBottomPanelDragEnd = useCallback(() => {
    updateDragging(null)
    resumeBrowserNativeBounds()
  }, [resumeBrowserNativeBounds, updateDragging])
  const handleBrowserPanelAnimationStart = useCallback(() => {
    if (dragging === 'browser') {
      return
    }
    pauseBrowserNativeBoundsForLayout(true)
  }, [dragging, pauseBrowserNativeBoundsForLayout])
  const handleBrowserPanelAnimationComplete = useCallback(() => {
    if (dragging === 'browser') {
      return
    }
    if (!browserPanelVisible) {
      setBrowserPanelClosing(false)
    }
    resumeBrowserNativeBounds()
  }, [browserPanelVisible, dragging, resumeBrowserNativeBounds])

  useEffect(
    () => () => {
      clearBrowserNativeBoundsResumeTimer()
    },
    [clearBrowserNativeBoundsResumeTimer],
  )

  useEffect(() => {
    if (browserPanelVisible || browserPanelClosing || browserNativeBoundsPaused) {
      return
    }
    clearBrowserNativeBoundsResumeTimer()
  }, [
    browserNativeBoundsPaused,
    browserPanelClosing,
    browserPanelVisible,
    clearBrowserNativeBoundsResumeTimer,
  ])

  useEffect(() => {
    const initialState = useLayoutStore.getState()
    let previousSidebarCollapsed = initialState.sidebarCollapsed
    let previousAsideOpen = initialState.asideOpen
    return useLayoutStore.subscribe((state) => {
      const sidebarToggled = previousSidebarCollapsed !== state.sidebarCollapsed
      const asideToggled = previousAsideOpen !== state.asideOpen
      previousSidebarCollapsed = state.sidebarCollapsed
      previousAsideOpen = state.asideOpen

      if (!sidebarToggled && !asideToggled) {
        return
      }
      if (dragging === 'browser') {
        return
      }
      pauseBrowserNativeBoundsForLayout()
    })
  }, [dragging, pauseBrowserNativeBoundsForLayout])

  const handleAsideLayoutResizeStart = useCallback(() => {
    pauseBrowserNativeBounds()
  }, [pauseBrowserNativeBounds])
  const handleAsideLayoutResizeEnd = useCallback(() => {
    resumeBrowserNativeBounds()
  }, [resumeBrowserNativeBounds])

  const browserPanelNativeBoundsPaused = browserNativeBoundsPaused || browserPanelClosing
  const browserPanelActivityVisible
    = browserPanelVisible || browserPanelClosing || browserNativeBoundsPaused

  const handleToggleZenSidebars = useCallback(() => {
    const { asideOpen, setAsideOpen, setSidebarCollapsed, sidebarCollapsed }
      = useLayoutStore.getState()
    const shouldCollapse = !sidebarCollapsed && (!canUseRightAside || asideOpen)
    setSidebarCollapsed(shouldCollapse)
    if (canUseRightAside) {
      setAsideOpen(!shouldCollapse)
    }
  }, [canUseRightAside])

  useShortcut('toggle-zen-sidebars', { meta: true, key: '.' }, handleToggleZenSidebars)

  const handleToggleRightAsideSheet = useCallback(() => {
    setRightAsideSheetOpen(open => !open)
  }, [])

  useEffect(() => {
    if (!rightAsideInSheet || !canUseRightAside) {
      setRightAsideSheetOpen(false)
    }
  }, [canUseRightAside, rightAsideInSheet])

  useEffect(() => {
    useBrowserPanelStore.getState().setActiveOwner(activeBrowserPanelOwnerId)
    setActiveBrowserPanelOwner(activeBrowserPanelOwnerId)
  }, [activeBrowserPanelOwnerId, setActiveBrowserPanelOwner])

  useEffect(() => {
    if (!isElectron) {
      return
    }
    return installBrowserUseBridge({
      ownerId: activeBrowserPanelOwnerId,
      openBrowserPanel: () => setBrowserPanelOpen(true, activeBrowserPanelOwnerId),
      closeBrowserPanel: () => setBrowserPanelOpen(false, activeBrowserPanelOwnerId),
      readBrowserTabSource,
    })
  }, [activeBrowserPanelOwnerId, readBrowserTabSource, setBrowserPanelOpen])

  return (
    <div className="flex flex-1 flex-col overflow-hidden text-foreground">
      {/* ── Full-width top header — toggle + breadcrumbs ── */}
      <AppHeader
        hasAside={resolvedHasAside}
        hasBrowserPanel={resolvedHasBrowserPanel}
        hasPanel={resolvedHasPanel}
        browserPanelOwnerId={activeBrowserPanelOwnerId}
        browserPanelOpen={browserPanelOpen}
        sessionScoped={sessionScoped}
        headerActions={slots.headerActions}
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={onOpenSidebarSheet}
        onToggleSidebarSheet={onToggleSidebarSheet}
        asideInSheet={rightAsideInSheet}
        asideSheetOpen={rightAsideSheetOpen}
        onToggleAsideSheet={handleToggleRightAsideSheet}
      />

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Center column */}
        <m.div
          ref={registerCenterColumn}
          data-slot="app-center-column"
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background rounded-xl shadow-[var(--shadow-sm)] z-10 m-1 mr-2"
          animate={
            jarvisExpanded
              ? { scale: CENTER_COLUMN_EXPANDED_SCALE, y: CENTER_COLUMN_EXPANDED_Y, opacity: 0.6 }
              : { scale: 1, y: 0, opacity: 1 }
          }
          transition={SPRING}
        >
          <main
            ref={mainRef}
            className="flex flex-row flex-1 bg-background overflow-hidden rounded-xl"
          >
            <div className="flex flex-col flex-1 overflow-hidden min-w-0">{children}</div>

            {/* Browser panel split */}
            {browserPanelVisible && (
              <ResizeHandle
                direction="horizontal"
                value={() => browserPanelRatio * readMainWidth()}
                onChange={handleBrowserPanelResize}
                onDragStart={handleBrowserPanelDragStart}
                onChangeEnd={handleBrowserPanelResizeEnd}
                min={() => readMainWidth() * 0.2}
                max={() => readMainWidth() * 0.7}
                inverted
                className="bg-background"
              />
            )}
            <m.div
              ref={browserPanelElementRef}
              initial={false}
              animate={{ width: browserPanelVisible ? `${browserPanelRatio * 100}%` : '0%' }}
              transition={dragging === 'browser' ? INSTANT : SPRING}
              onAnimationStart={handleBrowserPanelAnimationStart}
              onAnimationComplete={handleBrowserPanelAnimationComplete}
              className={cn(
                'flex shrink-0 flex-col overflow-hidden',
                browserPanelActivityVisible && 'border-l border-border/50',
              )}
              data-testid="app-layout-browser-panel"
              data-panel-open={browserPanelVisible ? 'true' : 'false'}
            >
              {browserPanelMounted && (
                <Activity
                  mode={browserPanelActivityVisible ? 'visible' : 'hidden'}
                  name="browser-panel"
                >
                  <BrowserPanel
                    ownerId={activeBrowserPanelOwnerId}
                    activeSessionId={activeSessionId}
                    activeSessionTitle={activeSessionTitle}
                    nativeBoundsPaused={browserPanelNativeBoundsPaused}
                    onCloseLastTab={handleCloseLastBrowserPanelTab}
                  />
                </Activity>
              )}
            </m.div>
          </main>

          {/* Bottom panel resize handle */}
          {!isSettings && bottomPanelOpen && resolvedHasPanel && (
            <ResizeHandle
              direction="vertical"
              value={bottomPanelHeight}
              onChange={setBottomPanelHeight}
              onDragStart={handleBottomPanelDragStart}
              onDragEnd={handleBottomPanelDragEnd}
              min={PANEL.min}
              max={PANEL.max}
              inverted
              className="bg-background"
            />
          )}
          {/* Bottom panel — always mounted to preserve xterm state */}
          {!isSettings && resolvedHasPanel && (
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
        {canUseRightAside && !rightAsideInSheet && (
          <AppRightAside
            sessionId={resolvedAsideSessionId}
            workspaceId={resolvedAsideWorkspaceId}
            workspaceName={resolvedAsideWorkspaceName}
            workspacePath={resolvedAsideWorkspacePath}
            onResizeStart={handleAsideLayoutResizeStart}
            onResizeEnd={handleAsideLayoutResizeEnd}
          />
        )}
        {canUseRightAside && rightAsideInSheet && (
          <ChromeSideSheet
            open={rightAsideSheetOpen}
            onOpenChange={setRightAsideSheetOpen}
            side="right"
            title={t('chromeSheet.rightAside.title')}
            closeLabel={t('chromeSheet.action.close')}
            contentTestId="app-layout-right-aside"
            className="w-[min(22rem,calc(100vw-2rem))]"
          >
            <MemoizedRightAside
              sessionId={resolvedAsideSessionId}
              workspaceId={resolvedAsideWorkspaceId}
              workspaceName={resolvedAsideWorkspaceName}
              workspacePath={resolvedAsideWorkspacePath}
            />
          </ChromeSideSheet>
        )}
      </div>

      {/* Footer */}
      {showFooter && <AppFooter />}
      {showFooter && import.meta.env.DEV && <DevBottomBar />}
    </div>
  )
}

interface AppRightAsideProps {
  sessionId?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

function AppRightAside({
  sessionId,
  workspaceId,
  workspaceName,
  workspacePath,
  onResizeStart,
  onResizeEnd,
}: AppRightAsideProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const asideElementRef = useRef<HTMLElement | null>(null)
  const asideContentElementRef = useRef<HTMLDivElement | null>(null)
  const asideWidth = useLayoutStore(state => state.asideWidth)
  const setAsideWidth = useLayoutStore(state => state.setAsideWidth)
  const asideOpen = useLayoutStore(state => state.asideOpen)

  const handleAsideResize = useCallback((width: number) => {
    const aside = asideElementRef.current
    const content = asideContentElementRef.current
    if (aside) {
      aside.style.width = `${width}px`
    }
    if (content) {
      content.style.width = `${width}px`
    }
  }, [])
  const handleAsideResizeEnd = useCallback(
    (width: number) => {
      const aside = asideElementRef.current
      const content = asideContentElementRef.current
      if (aside) {
        aside.style.width = `${width}px`
      }
      if (content) {
        content.style.width = `${width}px`
      }
      setAsideWidth(width)
      setDragging(null)
      onResizeEnd?.()
    },
    [onResizeEnd, setAsideWidth],
  )

  return (
    <>
      {asideOpen && (
        <ResizeHandle
          direction="horizontal"
          value={asideWidth}
          onChange={handleAsideResize}
          onDragStart={() => {
            setDragging('aside')
            onResizeStart?.()
          }}
          onChangeEnd={handleAsideResizeEnd}
          min={ASIDE.min}
          max={ASIDE.max}
          inverted
        />
      )}
      <m.aside
        ref={asideElementRef}
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
          ref={asideContentElementRef}
          className="flex flex-col flex-1 overflow-hidden"
          style={{ width: asideWidth }}
        >
          <MemoizedRightAside
            sessionId={sessionId}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            workspacePath={workspacePath}
          />
        </div>
      </m.aside>
    </>
  )
}
