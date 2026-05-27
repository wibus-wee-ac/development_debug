/* eslint-disable react-refresh/only-export-components */
import { Activity, createContext, memo, Profiler, Suspense, use, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { z } from 'zod'

import { cn } from '../cn'
import { useTabsContext } from '../context'
import { recordRendererCommit, recordRendererDuration, setActivityIdsSource } from '../debug'
import { selectCurrentLocation } from '../store'
import type { TabContextState, TabInstance, TabRouteDefinition } from '../types'

export interface TabRendererProps {
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  className?: string
}

const SCROLL_VIEW_STATE_KEY = 'tabs-next:scroll-positions'
const MAX_SCROLL_POSITIONS = 64
const TabFrameActiveContext = createContext(true)

interface ScrollPosition {
  key: string
  left: number
  top: number
}

const ScrollPositionsSchema = z.union([
  z.array(z.object({
    key: z.string(),
    left: z.number().finite(),
    top: z.number().finite(),
  })),
  z.null().transform(() => []),
  z.undefined().transform(() => []),
])

export function TabRenderer({ fallback, wrapper: Wrapper, className }: TabRendererProps) {
  'use no memo'
  const { store, registry } = useTabsContext()
  const tabs = store(s => s.tabs)
  const contexts = store(s => s.contexts)
  const activeTabId = store(s => s.activeTabId)
  const contextById = new Map(contexts.map(context => [context.id, context]))
  const readinessKeyById = new Map<string, string>()
  const activityIds: string[] = []
  for (const tab of tabs) {
    const context = contextById.get(tab.id)
    const location = context ? selectCurrentLocation(context) : null
    if (context && location && registry[location.routeId]) {
      readinessKeyById.set(tab.id, serializeLocationKey(location))
      activityIds.push(tab.id)
    }
  }
  const [readyKeys, setReadyKeys] = useState<Record<string, string>>({})
  const [lastReadyDisplayedTabId, setLastReadyDisplayedTabId] = useState<string | null>(activeTabId)
  const activeReadinessKey = activeTabId ? readinessKeyById.get(activeTabId) : undefined
  const activeReady = activeTabId !== null && activeReadinessKey !== undefined && readyKeys[activeTabId] === activeReadinessKey
  const displayedTabId = activeReady ? activeTabId : lastReadyDisplayedTabId
  const saveScrollPositions = useCallback((tabId: string, positions: ScrollPosition[]) => {
    store.getState().updateTabViewState(tabId, SCROLL_VIEW_STATE_KEY, positions)
  }, [store])
  const handleContentReady = useCallback((tabId: string, readinessKey: string) => {
    setReadyKeys((current) => {
      if (current[tabId] === readinessKey) {
        return current
      }
      return { ...current, [tabId]: readinessKey }
    })
    if (store.getState().activeTabId === tabId && lastReadyDisplayedTabId === null) {
      setLastReadyDisplayedTabId(tabId)
    }
  }, [lastReadyDisplayedTabId, store])

  useLayoutEffect(() => {
    recordRendererCommit()
    setActivityIdsSource(() => activityIds)
  })

  const handleProfilerRender: React.ComponentProps<typeof Profiler>['onRender'] = (
    _id,
    _phase,
    actualDuration,
  ) => {
    recordRendererDuration(actualDuration)
  }

  const content = (
    <div className={cn('relative min-h-0 min-w-0 overflow-hidden', className ?? 'flex-1 flex')} data-testid="tab-content-renderer">
      {tabs.map((tab) => {
        const context = contextById.get(tab.id)
        const location = context ? selectCurrentLocation(context) : null
        const route = location ? registry[location.routeId] : undefined
        if (!context || !location || !route) {
          return null
        }

        const visible = tab.id === activeTabId
        const active = tab.id === activeTabId
        const readinessKey = readinessKeyById.get(tab.id) ?? tab.id
        const frame = (
          <TabRouteFrame
            key={tab.id}
            tab={tab}
            context={context}
            route={route}
            visible={visible}
            active={active}
            readinessKey={readinessKey}
            fallback={fallback}
            wrapper={Wrapper}
            onSaveScrollPositions={saveScrollPositions}
            onContentReady={handleContentReady}
          />
        )

        if (context.keepAlive === 'discardable') {
          return (
            <Activity key={tab.id} name={`tab:${tab.id}`} mode={active ? 'visible' : 'hidden'}>
              {frame}
            </Activity>
          )
        }

        return frame
      })}
    </div>
  )

  if (!isRendererDurationProfilingEnabled()) {
    return content
  }

  return (
    <Profiler id="tabs-next-renderer" onRender={handleProfilerRender}>
      {content}
    </Profiler>
  )
}

export function useTabFrameActive(): boolean {
  return use(TabFrameActiveContext)
}

const TabRouteFrame = memo(({
  tab,
  context,
  route,
  visible,
  active,
  readinessKey,
  fallback,
  wrapper: Wrapper,
  onSaveScrollPositions,
  onContentReady,
}: {
  tab: TabInstance
  context: TabContextState
  route: TabRouteDefinition
  visible: boolean
  active: boolean
  readinessKey: string
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  onSaveScrollPositions: (tabId: string, positions: ScrollPosition[]) => void
  onContentReady: (tabId: string, readinessKey: string) => void
}) => {
  return (
    <ActivityTabFrame
      tab={tab}
      context={context}
      visible={visible}
      onSaveScrollPositions={onSaveScrollPositions}
    >
      <TabFrameActiveContext value={active}>
        <RetainedTabRouteContent
          tab={tab}
          route={route}
          readinessKey={readinessKey}
          fallback={fallback}
          wrapper={Wrapper}
          onContentReady={onContentReady}
        />
      </TabFrameActiveContext>
    </ActivityTabFrame>
  )
})

const RetainedTabRouteContent = memo(({
  tab,
  route,
  readinessKey,
  fallback,
  wrapper: Wrapper,
  onContentReady,
}: {
  tab: TabInstance
  route: TabRouteDefinition
  readinessKey: string
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  onContentReady: (tabId: string, readinessKey: string) => void
}) => {
  return Wrapper
    ? (
      <Wrapper>
        <TabRouteContent tab={tab} route={route} readinessKey={readinessKey} fallback={fallback} onContentReady={onContentReady} />
      </Wrapper>
    )
    : <TabRouteContent tab={tab} route={route} readinessKey={readinessKey} fallback={fallback} onContentReady={onContentReady} />
})

const ActivityTabFrame = memo(({
  tab,
  context,
  visible,
  onSaveScrollPositions,
  children,
}: {
  tab: TabInstance
  context: TabContextState
  visible: boolean
  onSaveScrollPositions: (tabId: string, positions: ScrollPosition[]) => void
  children: React.ReactNode
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const savedPositions = useMemo(
    () => ScrollPositionsSchema.parse(context.viewState[SCROLL_VIEW_STATE_KEY]),
    [context.viewState],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || savedPositions.length === 0) {
      return
    }

    restoreScrollPositions(root, savedPositions)
  }, [savedPositions, tab.id])

  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (!root) {
        return
      }
      onSaveScrollPositions(tab.id, captureScrollPositions(root))
    }
  }, [onSaveScrollPositions, tab.id])

  return (
    <div
      ref={rootRef}
      className={cn(
        'absolute inset-0 h-full w-full min-h-0 min-w-0 overflow-hidden',
        visible
          ? 'visible z-10 opacity-100 pointer-events-auto'
          : 'invisible z-0 opacity-0 pointer-events-none',
      )}
      style={{
        contain: 'layout paint style',
        contentVisibility: visible ? 'visible' : 'hidden',
      }}
      aria-hidden={visible ? undefined : 'true'}
      data-testid={`tab-content-${tab.id}`}
      data-tab-visible={visible ? 'true' : 'false'}
    >
      {children}
    </div>
  )
})

function captureScrollPositions(root: HTMLElement): ScrollPosition[] {
  const positions: ScrollPosition[] = []
  for (const { key, element } of getScrollCandidates(root)) {
    if (positions.length >= MAX_SCROLL_POSITIONS) {
      break
    }
    if (element.scrollTop === 0 && element.scrollLeft === 0) {
      continue
    }
    positions.push({ key, top: element.scrollTop, left: element.scrollLeft })
  }
  return positions
}

function restoreScrollPositions(root: HTMLElement, positions: ScrollPosition[]): void {
  const candidateByKey = new Map(getScrollCandidates(root).map(item => [item.key, item.element]))
  for (const position of positions) {
    const element = candidateByKey.get(position.key)
    if (!element) {
      continue
    }
    element.scrollTop = position.top
    element.scrollLeft = position.left
  }
}

function getScrollCandidates(root: HTMLElement): Array<{ key: string, element: HTMLElement }> {
  const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  const candidates: Array<{ key: string, element: HTMLElement }> = []

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]
    if (!element || !canScroll(element)) {
      continue
    }
    candidates.push({ key: index === 0 ? 'root' : `node:${index}`, element })
  }

  return candidates
}

function canScroll(element: HTMLElement): boolean {
  return (
    element.scrollHeight > element.clientHeight + 1
    || element.scrollWidth > element.clientWidth + 1
    || element.scrollTop !== 0
    || element.scrollLeft !== 0
  )
}

function isRendererDurationProfilingEnabled(): boolean {
  return typeof window !== 'undefined' && window.__CRADLE_TABS_PROFILE_RENDERER__ === true
}

interface TabRouteContentProps {
  tab: TabInstance
  route: TabRouteDefinition
  readinessKey: string
  fallback?: React.ReactNode
  onContentReady: (tabId: string, readinessKey: string) => void
}

function TabRouteContent({ tab, route, readinessKey, fallback, onContentReady }: TabRouteContentProps) {
  'use no memo'
  const Component = route.component

  if (!route.loader) {
    return (
      <Suspense fallback={fallback ?? null}>
        <Component params={tab.params} />
        <TabRouteReadyMarker tabId={tab.id} readinessKey={readinessKey} onContentReady={onContentReady} />
      </Suspense>
    )
  }

  return <RouteLoaderBoundary tab={tab} route={route} readinessKey={readinessKey} suspenseFallback={fallback} onContentReady={onContentReady} />
}

function TabRouteReadyMarker({
  tabId,
  readinessKey,
  onContentReady,
}: {
  tabId: string
  readinessKey: string
  onContentReady: (tabId: string, readinessKey: string) => void
}) {
  const markContentReady = useEffectEvent((nextTabId: string, nextReadinessKey: string) => {
    onContentReady(nextTabId, nextReadinessKey)
  })

  useLayoutEffect(() => {
    queueMicrotask(() => {
      markContentReady(tabId, readinessKey)
    })
  }, [readinessKey, tabId])

  return null
}

interface LoaderState {
  status: 'idle' | 'loading' | 'success' | 'error'
  data: unknown
  error: unknown
  paramsKey: string
}

type LoaderAction
  = | { type: 'loading', paramsKey: string }
    | { type: 'success', data: unknown, paramsKey: string }
    | { type: 'error', error: unknown, paramsKey: string }

const INITIAL_LOADER_STATE: LoaderState = {
  status: 'idle',
  data: undefined,
  error: undefined,
  paramsKey: '',
}

function loaderReducer(state: LoaderState, action: LoaderAction): LoaderState {
  switch (action.type) {
    case 'loading':
      return { status: 'loading', data: undefined, error: undefined, paramsKey: action.paramsKey }
    case 'success':
      return { status: 'success', data: action.data, error: undefined, paramsKey: action.paramsKey }
    case 'error':
      return { status: 'error', data: undefined, error: action.error, paramsKey: action.paramsKey }
    default:
      return state
  }
}

function serializeParams(params: Record<string, string | undefined>): string {
  return JSON.stringify(
    Object.keys(params).sort().reduce<Record<string, string | undefined>>((acc, key) => {
      acc[key] = params[key]
      return acc
    }, {}),
  )
}

function RouteLoaderBoundary({
  tab,
  route,
  readinessKey,
  suspenseFallback,
  onContentReady,
}: {
  tab: TabInstance
  route: TabRouteDefinition
  readinessKey: string
  suspenseFallback?: React.ReactNode
  onContentReady: (tabId: string, readinessKey: string) => void
}) {
  'use no memo'
  const [state, dispatch] = useReducer(loaderReducer, INITIAL_LOADER_STATE)
  const currentParamsKey = serializeParams(tab.params)
  const loader = route.loader

  useEffect(() => {
    if (!loader) {
      return
    }

    let cancelled = false
    dispatch({ type: 'loading', paramsKey: currentParamsKey })
    loader(tab.params).then(
      (data) => {
        if (!cancelled) {
          dispatch({ type: 'success', data, paramsKey: currentParamsKey })
        }
      },
      (error) => {
        if (!cancelled) {
          dispatch({ type: 'error', error, paramsKey: currentParamsKey })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [currentParamsKey, loader, tab.params])

  const Component = route.component

  if (state.status === 'idle' || state.status === 'loading') {
    return <>{route.loaderFallback ?? suspenseFallback ?? null}</>
  }

  if (state.status === 'error') {
    return (
      <div style={{ padding: 16 }}>
        <p>Tab loader error</p>
        <pre style={{ fontSize: 12, opacity: 0.6 }}>{String(state.error)}</pre>
      </div>
    )
  }

  return (
    <Suspense fallback={suspenseFallback ?? null}>
      <Component params={tab.params} loaderData={state.data} />
      <TabRouteReadyMarker tabId={tab.id} readinessKey={readinessKey} onContentReady={onContentReady} />
    </Suspense>
  )
}

function serializeLocationKey(location: { routeId: string, params: Record<string, string | undefined>, pathname: string, search?: string }): string {
  return JSON.stringify({
    routeId: location.routeId,
    pathname: location.pathname,
    search: location.search ?? '',
    params: Object.keys(location.params).sort().reduce<Record<string, string | undefined>>((acc, key) => {
      acc[key] = location.params[key]
      return acc
    }, {}),
  })
}
