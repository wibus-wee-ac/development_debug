import type { AnimationPlaybackControls, Transition } from 'motion/react'
import { animate, m, useMotionValue } from 'motion/react'
import type { ReactNode } from 'react'
import { Activity, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  // CHROME_CENTER_MIN_WIDTH,
  // CHROME_COLLAPSED_SIDEBAR_WIDTH,
  // CHROME_RESPONSIVE_GUTTER_WIDTH,
  useViewportWidth,
} from '~/components/layout/layout-responsive'
import { ResizeHandle } from '~/components/layout/resize-handle'
import { useLayoutSlotsCtx } from '~/components/layout/use-layout-slots'
import { useJarvisUiStore } from '~/features/system-agent/jarvis-ui-store'
import { useGlobalEventListeners } from '~/hooks/use-global-event-listeners'
import { useShortcut } from '~/hooks/use-shortcut'
import { cn } from '~/lib/cn'
import { isElectron } from '~/lib/electron'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'
import type { BrowserTabSource } from '~/store/browser-panel'
import { DEFAULT_BROWSER_PANEL_OWNER_ID, useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSessionLayoutStore } from '~/store/session-layout'

const ASIDE = { min: 200, max: 560 }
const PANEL = { min: 80, max: 480 }

const SPRING = { type: 'spring', stiffness: 600, damping: 50 } as const
const INSTANT = { duration: 0 } as const
const BROWSER_NATIVE_BOUNDS_SETTLE_MS = 420

type BrowserBridgeCleanup = () => void

const LazyBrowserPanel = lazy(() =>
  import('~/features/browser').then(module => ({
    default: module.BrowserPanel,
  })))

const LazyRightAside = lazy(() =>
  import('~/components/layout/right-aside').then(module => ({
    default: module.RightAside,
  })))

const MemoizedRightAside = memo(LazyRightAside)
MemoizedRightAside.displayName = 'MemoizedRightAside'

function useAnimatedSize(initialSize: number) {
  const size = useMotionValue(initialSize)
  const animationRef = useRef<AnimationPlaybackControls | null>(null)

  const stopAnimation = useCallback(() => {
    animationRef.current?.stop()
    animationRef.current = null
  }, [])

  const setSize = useCallback((nextSize: number) => {
    stopAnimation()
    size.set(nextSize)
  }, [size, stopAnimation])

  const animateSize = useCallback((nextSize: number, transition: Transition) => {
    stopAnimation()
    animationRef.current = animate(size, nextSize, transition)
    return animationRef.current
  }, [size, stopAnimation])

  useEffect(
    () => () => {
      stopAnimation()
    },
    [stopAnimation],
  )

  return useMemo(() => ({ size, setSize, animateSize, stopAnimation }), [animateSize, setSize, size, stopAnimation])
}

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
  /** Limit route surface chrome actions to the current session window. */
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
  const mainElementRef = useRef<HTMLElement | null>(null)
  const previousBrowserPanelVisibleRef = useRef(false)
  const browserNativeBoundsResumeTimerRef = useRef<number | null>(null)
  const browserPanelWidthAnimationIdRef = useRef(0)
  const browserPanelWidthAnimatingRef = useRef(false)
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

  // Route surface layout slots registered by route content components.
  const { slots } = useLayoutSlotsCtx()
  const activeSurface = useSurfaceStore(
    useShallow((s) => {
      const surface = s.surfaces.find(item => item.id === s.activeSurfaceId)
      if (!surface) {
        return undefined
      }
      return {
        id: surface.id,
        kind: surface.kind,
        title: surface.title,
        route: surface.route,
      }
    }),
  )
  const activeTab = activeSurface
    ? {
        type: activeSurface.kind === 'workspace'
          ? 'workspace-detail'
          : activeSurface.kind,
        label: activeSurface.title,
        params: activeSurface.route.params ?? {},
      }
    : undefined
  const activeSessionId = chatSessionIdForSurface(activeSurface)
  const activeSessionTitle = activeTab?.type === 'chat' ? activeTab.label : null
  const activeBrowserPanelOwnerId = activeSurface?.id ?? null
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
  const isSettings = activeSurface?.kind === 'settings'
  const canUseRightAside
    = !isSettings && !!resolvedHasAside && (!!resolvedAsideSessionId || !!resolvedAsideWorkspaceId)
  const viewportWidth = useViewportWidth()
  // const rightAsideInSheet = canUseRightAside
    // && viewportWidth < dockedSidebarWidth + asideWidth + CHROME_CENTER_MIN_WIDTH + CHROME_RESPONSIVE_GUTTER_WIDTH
  const resolvedBrowserPanelOpen = !isSettings && !!resolvedHasBrowserPanel && browserPanelOpen
  const browserPanelMounted = !!resolvedHasBrowserPanel
  const browserPanelVisible = browserPanelMounted && resolvedBrowserPanelOpen
  const browserPanelWidth = useAnimatedSize(browserPanelVisible ? browserPanelRatio * readMainWidth() : 0)
  useLayoutEffect(() => {
    const previousBrowserPanelVisible = previousBrowserPanelVisibleRef.current
    previousBrowserPanelVisibleRef.current = browserPanelVisible

    if (browserPanelMounted && previousBrowserPanelVisible && !browserPanelVisible) {
      setBrowserPanelClosing(true)
      return
    }

    if (browserPanelVisible) {
      setBrowserPanelClosing(false)
    }
  }, [browserPanelMounted, browserPanelVisible])
  const readBrowserTabSource = useCallback((): BrowserTabSource => {
    return {
      sessionId: activeSessionId,
      sessionTitle: activeSessionTitle,
    }
  }, [activeSessionId, activeSessionTitle])
  const handleCloseLastBrowserPanelTab = useCallback((ownerId: string) => {
    setBrowserPanelOpen(false, ownerId)
  }, [setBrowserPanelOpen])
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
    browserPanelWidth.setSize(px)
  }, [browserPanelWidth])
  const handleBrowserPanelResizeEnd = useCallback((px: number) => {
    const mainWidth = readMainWidth()
    const ratio = Math.max(0.2, Math.min(0.7, px / mainWidth))
    browserPanelWidthAnimationIdRef.current += 1
    browserPanelWidthAnimatingRef.current = false
    browserPanelWidth.setSize(px)
    setBrowserPanelRatio(ratio)
    updateDragging(null)
  }, [browserPanelWidth, readMainWidth, setBrowserPanelRatio, updateDragging])
  const handleBrowserPanelDragStart = useCallback(() => {
    browserPanelWidthAnimationIdRef.current += 1
    browserPanelWidthAnimatingRef.current = false
    browserPanelWidth.setSize(browserPanelWidth.size.get())
    updateDragging('browser')
  }, [browserPanelWidth, updateDragging])
  const handleBottomPanelDragStart = useCallback(() => {
    updateDragging('panel')
    pauseBrowserNativeBounds()
  }, [pauseBrowserNativeBounds, updateDragging])
  const handleBottomPanelDragEnd = useCallback(() => {
    updateDragging(null)
    resumeBrowserNativeBounds()
  }, [resumeBrowserNativeBounds, updateDragging])

  useEffect(
    () => () => {
      clearBrowserNativeBoundsResumeTimer()
    },
    [clearBrowserNativeBoundsResumeTimer],
  )

  useEffect(() => {
    if (dragging === 'browser') {
      return
    }
    const nextWidth = browserPanelVisible ? browserPanelRatio * readMainWidth() : 0
    if (Math.abs(browserPanelWidth.size.get() - nextWidth) < 0.5) {
      if (!browserPanelVisible) {
        setBrowserPanelClosing(false)
      }
      return
    }

    const animationId = browserPanelWidthAnimationIdRef.current + 1
    browserPanelWidthAnimationIdRef.current = animationId
    browserPanelWidthAnimatingRef.current = true
    pauseBrowserNativeBoundsForLayout(true)

    const controls = browserPanelWidth.animateSize(nextWidth, SPRING)
    void controls.finished.then(() => {
      if (browserPanelWidthAnimationIdRef.current !== animationId) {
        return
      }
      browserPanelWidthAnimatingRef.current = false
      if (!browserPanelVisible) {
        setBrowserPanelClosing(false)
      }
      resumeBrowserNativeBounds()
    }).catch(() => { })
  }, [
    browserPanelRatio,
    browserPanelVisible,
    browserPanelWidth,
    dragging,
    pauseBrowserNativeBoundsForLayout,
    readMainWidth,
    resumeBrowserNativeBounds,
  ])

  useEffect(() => {
    const element = mainElementRef.current
    if (!element || typeof ResizeObserver === 'undefined') {
      return
    }

    const syncBrowserPanelWidth = () => {
      if (dragging === 'browser' || browserPanelWidthAnimatingRef.current) {
        return
      }
      browserPanelWidth.setSize(browserPanelVisible ? browserPanelRatio * readMainWidth() : 0)
    }

    const resizeObserver = new ResizeObserver(syncBrowserPanelWidth)
    resizeObserver.observe(element)
    window.addEventListener('resize', syncBrowserPanelWidth)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBrowserPanelWidth)
    }
  }, [browserPanelRatio, browserPanelVisible, browserPanelWidth, dragging, readMainWidth])

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

  useShortcut('toggle-zen-sidebars', { meta: true, key: '.', allowInEditable: true }, handleToggleZenSidebars)

  const handleToggleRightAsideSheet = useCallback(() => {
    setRightAsideSheetOpen(open => !open)
  }, [])

  // useEffect(() => {
    // if (!rightAsideInSheet || !canUseRightAside) {
      // setRightAsideSheetOpen(false)
    // }
  // }, [canUseRightAside, rightAsideInSheet])

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
                value={() => browserPanelWidth.size.get()}
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
              initial={false}
              style={{ width: browserPanelWidth.size }}
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
                  <Suspense fallback={null}>
                    <LazyBrowserPanel
                      ownerId={activeBrowserPanelOwnerId}
                      activeSessionId={activeSessionId}
                      activeSessionTitle={activeSessionTitle}
                      terminalCwd={resolvedAsideWorkspacePath}
                      nativeBoundsPaused={browserPanelNativeBoundsPaused}
                      onCloseLastTab={handleCloseLastBrowserPanelTab}
                    />
                  </Suspense>
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
        {canUseRightAside && (
          <AppRightAside
            sessionId={resolvedAsideSessionId}
            workspaceId={resolvedAsideWorkspaceId}
            workspaceName={resolvedAsideWorkspaceName}
            workspacePath={resolvedAsideWorkspacePath}
            onResizeStart={handleAsideLayoutResizeStart}
            onResizeEnd={handleAsideLayoutResizeEnd}
          />
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

const AppRightAside = memo(({
  sessionId,
  workspaceId,
  workspaceName,
  workspacePath,
  onResizeStart,
  onResizeEnd,
}: AppRightAsideProps) => {
  const asideWidth = useLayoutStore(state => state.asideWidth)
  const setAsideWidth = useLayoutStore(state => state.setAsideWidth)
  const asideOpen = useLayoutStore(state => state.asideOpen)
  const asideMotionWidth = useAnimatedSize(asideOpen ? asideWidth : 0)
  const [asideContentMounted, setAsideContentMounted] = useState(asideOpen)
  const asideAnimationIdRef = useRef(0)
  const shouldRenderAsideContent = asideOpen || asideContentMounted

  const handleAsideResize = useCallback((width: number) => {
    asideMotionWidth.setSize(width)
  }, [asideMotionWidth])
  const handleAsideResizeStart = useCallback(() => {
    asideMotionWidth.setSize(asideMotionWidth.size.get())
    onResizeStart?.()
  }, [asideMotionWidth, onResizeStart])
  const handleAsideResizeEnd = useCallback((width: number) => {
    asideMotionWidth.setSize(width)
    setAsideWidth(width)
    onResizeEnd?.()
  }, [asideMotionWidth, onResizeEnd, setAsideWidth])

  useEffect(() => {
    const nextWidth = asideOpen ? asideWidth : 0
    if (asideOpen) {
      setAsideContentMounted(true)
    }
    if (Math.abs(asideMotionWidth.size.get() - nextWidth) < 0.5) {
      if (!asideOpen) {
        setAsideContentMounted(false)
      }
      return
    }
    const animationId = asideAnimationIdRef.current + 1
    asideAnimationIdRef.current = animationId
    const controls = asideMotionWidth.animateSize(nextWidth, SPRING)
    if (!asideOpen) {
      void controls.finished.then(() => {
        if (asideAnimationIdRef.current === animationId) {
          setAsideContentMounted(false)
        }
      }).catch(() => { })
    }
  }, [asideMotionWidth, asideOpen, asideWidth])

  return (
    <>
      {asideOpen && (
        <ResizeHandle
          direction="horizontal"
          value={() => asideMotionWidth.size.get()}
          onChange={handleAsideResize}
          onDragStart={handleAsideResizeStart}
          onChangeEnd={handleAsideResizeEnd}
          min={ASIDE.min}
          max={ASIDE.max}
          inverted
        />
      )}
      <m.aside
        initial={false}
        animate={{ opacity: asideOpen ? 1 : 0 }}
        transition={SPRING}
        style={{ width: asideMotionWidth.size }}
        className="flex shrink-0 overflow-hidden bg-sidebar"
        data-testid="app-layout-right-aside"
        data-aside-open={asideOpen ? 'true' : 'false'}
        aria-hidden={asideOpen ? undefined : 'true'}
      >
        <m.div
          className="flex flex-col flex-1 overflow-hidden"
          style={{ width: asideWidth }}
        >
          {shouldRenderAsideContent && (
            <Suspense fallback={null}>
              <MemoizedRightAside
                sessionId={sessionId}
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                workspacePath={workspacePath}
              />
            </Suspense>
          )}
        </m.div>
      </m.aside>
    </>
  )
})
AppRightAside.displayName = 'AppRightAside'
