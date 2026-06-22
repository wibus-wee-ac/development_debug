import { Outlet, useLocation, useNavigate, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useThemeClass } from '~/app-providers'
import { AppLayout } from '~/components/layout/app-layout'
import { AppSidebar, AppSidebarSheet } from '~/components/layout/app-sidebar'
import { useSidebarSheetMode } from '~/components/layout/layout-responsive'
import { useSyncLayoutSlotScope } from '~/components/layout/use-layout-slots'
import { useDesktopTrayActionBridge } from '~/features/desktop-tray/use-desktop-tray-action-bridge'
import { CredentialSetupDialog } from '~/features/onboarding/credential-setup-dialog'
import { useOnboardingStore } from '~/features/onboarding/onboarding-store'
import { useGlobalSearchStore } from '~/features/search/global-search-store'
import { useUnreadSessionIds } from '~/features/workspace/use-session'
import { isWorkspaceFileShortcutScopeEvent } from '~/features/workspace/workspace-file-shortcuts'
import { isTearoffWindow, tearoffSessionId } from '~/lib/electron'
import { surfaceDraftFromRouterState, useActiveSurface } from '~/navigation/active-surface'
import { createRouteSurfaceSyncRouteKey, isRouteSurfaceSyncSuppressed } from '~/navigation/route-surface-sync-key'
import { SurfaceActivityProvider } from '~/navigation/surface-activity-context'
import { layoutSlotIdForSurface } from '~/navigation/surface-identity'
import { installSurfaceResourceLifecycle } from '~/navigation/surface-resource-lifecycle'
import { useSurfaceStore } from '~/navigation/surface-store'
import { installTearoffSessionRestore } from '~/navigation/tearoff-sessions'
import { chatSelectors, useChatStore } from '~/store/chat'

const loadGlobalSearchDialog = () =>
  import('~/features/search/global-search-dialog').then(module => ({
    default: module.GlobalSearchDialog,
  }))

const GlobalSearchDialog = lazy(loadGlobalSearchDialog)

const StreamingChatRetentionHost = lazy(() =>
  import('~/features/chat/session/streaming-chat-retention-host').then(module => ({
    default: module.StreamingChatRetentionHost,
  })))

function syncDesktopAppBadgeUnreadCount(count: number): void {
  const promise = window.cradle?.desktopAppBadge?.setUnreadCount(count)
  void promise?.catch(() => {})
}

function RouteSurfaceSync() {
  'use no memo'

  const syncSurface = useSurfaceStore(state => state.syncSurface)
  const lastSyncedRouteKeyRef = useRef<string | null>(null)
  const routeSnapshot = useRouterState({
    select: (state) => {
      const location = state.location as typeof state.location & { href?: string }
      return {
        routeKey: createRouteSurfaceSyncRouteKey(location),
        surface: surfaceDraftFromRouterState(state),
      }
    },
    structuralSharing: true,
  })

  useEffect(() => {
    const surface = routeSnapshot.surface
    if (!surface) {
      return
    }

    if (isRouteSurfaceSyncSuppressed(surface.id)) {
      return
    }

    const syncKey = `${routeSnapshot.routeKey}:${surface.id}`
    if (lastSyncedRouteKeyRef.current === syncKey) {
      return
    }
    lastSyncedRouteKeyRef.current = syncKey
    syncSurface(surface)
  }, [routeSnapshot, syncSurface])

  return null
}

export function AppRouteRoot() {
  'use no memo'

  const onboardingCompleted = useOnboardingStore(s => s.completed)
  const location = useLocation()
  const navigate = useNavigate()
  const isOnboardingRoute = location.pathname === '/onboarding'

  useThemeClass()

  useEffect(() => {
    if (isTearoffWindow) {
      return
    }
    if (!onboardingCompleted && !isOnboardingRoute) {
      void navigate({ to: '/onboarding', replace: true })
      return
    }
    if (onboardingCompleted && isOnboardingRoute) {
      void navigate({ to: '/', replace: true })
    }
  }, [isOnboardingRoute, navigate, onboardingCompleted])

  if (isTearoffWindow) {
    return <TearoffAppRuntime />
  }

  if (!onboardingCompleted && !isOnboardingRoute) {
    return <div className="h-screen w-screen bg-background" />
  }

  if (isOnboardingRoute) {
    return (
      <>
        <RouteSurfaceSync />
        <Outlet />
      </>
    )
  }

  return (
    <>
      <RouteSurfaceSync />
      <MainAppRuntime />
      <CredentialSetupDialog />
    </>
  )
}

function TearoffAppRuntime() {
  'use no memo'

  const sessionId = tearoffSessionId
  const navigate = useNavigate()

  useEffect(() => {
    document.body.dataset.surface = 'tearoff'
  }, [])

  useEffect(() => {
    if (!sessionId) {
      return
    }
    void navigate({
      to: '/chat/$sessionId',
      params: { sessionId },
      replace: true,
    })
  }, [navigate, sessionId])

  useEffect(() => {
    return installSurfaceResourceLifecycle()
  }, [])

  if (!sessionId) {
    return (
      <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
        <div className="h-full w-full bg-background" />
      </div>
    )
  }

  return (
    <>
      <RouteSurfaceSync />
      <TearoffLayoutScope sessionId={sessionId}>
        <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
          <AppLayout sessionScoped showFooter={false}>
            <SurfaceActivityProvider active>
              <Outlet />
            </SurfaceActivityProvider>
          </AppLayout>
        </div>
      </TearoffLayoutScope>
    </>
  )
}

function TearoffLayoutScope({
  children,
  sessionId,
}: {
  children: React.ReactNode
  sessionId: string
}) {
  useSyncLayoutSlotScope(sessionId, [sessionId])
  return children
}

function MainAppRuntime() {
  'use no memo'

  const sidebarInSheet = useSidebarSheetMode()
  const [sidebarSheetOpen, setSidebarSheetOpen] = useState(false)
  const activeSurface = useActiveSurface()
  const layoutSlotScope = useSurfaceStore(
    useShallow((state) => {
      const validSlotIds = state.surfaces
        .map(layoutSlotIdForSurface)
        .filter((id): id is string => id !== null)
      return {
        validSurfaceIdsKey: state.surfaces.map(surface => surface.id).join('\0'),
        validSlotIdsKey: validSlotIds.join('\0'),
      }
    }),
  )
  const validSurfaceIds = useMemo(
    () =>
      layoutSlotScope.validSurfaceIdsKey ? layoutSlotScope.validSurfaceIdsKey.split('\0') : [],
    [layoutSlotScope.validSurfaceIdsKey],
  )
  const validSlotIds = useMemo(
    () => (layoutSlotScope.validSlotIdsKey ? layoutSlotScope.validSlotIdsKey.split('\0') : []),
    [layoutSlotScope.validSlotIdsKey],
  )

  useSyncLayoutSlotScope(layoutSlotIdForSurface(activeSurface), validSlotIds)

  const openGlobalSearch = useCallback(() => {
    void loadGlobalSearchDialog()
    useGlobalSearchStore.getState().openSearch()
  }, [])
  const openSidebarSheet = useCallback(() => {
    setSidebarSheetOpen(true)
  }, [])
  const toggleSidebarSheet = useCallback(() => {
    setSidebarSheetOpen(open => !open)
  }, [])
  const unreadSessionIds = useUnreadSessionIds()

  useDesktopTrayActionBridge({ onOpenGlobalSearch: openGlobalSearch })

  useEffect(() => {
    return installSurfaceResourceLifecycle()
  }, [])

  useEffect(() => {
    return installTearoffSessionRestore()
  }, [])

  useEffect(() => {
    syncDesktopAppBadgeUnreadCount(unreadSessionIds.size)
  }, [unreadSessionIds.size])

  useEffect(() => {
    if (!sidebarInSheet) {
      setSidebarSheetOpen(false)
    }
  }, [sidebarInSheet])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-sidebar">
      {!sidebarInSheet && <AppSidebar />}
      {sidebarInSheet && (
        <AppSidebarSheet open={sidebarSheetOpen} onOpenChange={setSidebarSheetOpen} />
      )}
      <AppLayout
        sidebarInSheet={sidebarInSheet}
        sidebarSheetOpen={sidebarSheetOpen}
        onOpenSidebarSheet={openSidebarSheet}
        onToggleSidebarSheet={toggleSidebarSheet}
        validChromeOwnerIds={validSurfaceIds}
      >
        <div className="relative h-full w-full overflow-hidden">
          <SurfaceActivityProvider active>
            <Outlet />
          </SurfaceActivityProvider>
          <GlobalCommandPaletteHost />
        </div>
      </AppLayout>
      <StreamingChatRetentionBoundary />
    </div>
  )
}

function StreamingChatRetentionBoundary() {
  'use no memo'

  const hasStreamingSessions = useChatStore((state) => {
    for (const sessionId of state.messagesMap.keys()) {
      if (chatSelectors.isSessionStreaming(sessionId)(state)) {
        return true
      }
    }
    return false
  })

  if (!hasStreamingSessions) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <StreamingChatRetentionHost />
    </Suspense>
  )
}

function GlobalCommandPaletteHost() {
  'use no memo'

  const open = useGlobalSearchStore(s => s.open)
  const initialQuery = useGlobalSearchStore(s => s.initialQuery)
  const setOpen = useGlobalSearchStore(s => s.setOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      const isMod = event.metaKey || event.ctrlKey
      if (!isMod || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'k') {
        if (isWorkspaceFileShortcutScopeEvent(event)) {
          return
        }
        event.preventDefault()
        void loadGlobalSearchDialog()
        useGlobalSearchStore.getState().openPalette('>')
        return
      }

      if (key === 'p') {
        event.preventDefault()
        void loadGlobalSearchDialog()
        useGlobalSearchStore.getState().openPalette(event.shiftKey ? '>' : '')
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  if (!open) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <GlobalSearchDialog open={open} initialQuery={initialQuery} onOpenChange={setOpen} />
    </Suspense>
  )
}
