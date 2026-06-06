import { Activity, createContext, memo, Profiler, Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
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
  const activeTabId = store(s => s.activeTabId)
  const saveScrollPositions = useCallback((tabId: string, positions: ScrollPosition[]) => {
    store.getState().updateTabViewState(tabId, SCROLL_VIEW_STATE_KEY, positions)
  }, [store])

  useLayoutEffect(() => {
    recordRendererCommit()
    setActivityIdsSource(() => {
      const { tabs: currentTabs, contexts } = store.getState()
      const contextById = new Map(contexts.map(c => [c.id, c]))
      return currentTabs
        .filter((tab) => {
          const ctx = contextById.get(tab.id)
          const loc = ctx ? selectCurrentLocation(ctx) : null
          return ctx && loc && registry[loc.routeId]
        })
        .map(tab => tab.id)
    })
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
      {tabs.map(tab => (
        <TabRouteFrame
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          fallback={fallback}
          wrapper={Wrapper}
          onSaveScrollPositions={saveScrollPositions}
        />
      ))}
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
  active,
  fallback,
  wrapper: Wrapper,
  onSaveScrollPositions,
}: {
  tab: TabInstance
  active: boolean
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  onSaveScrollPositions: (tabId: string, positions: ScrollPosition[]) => void
}) => {
  const { store, registry } = useTabsContext()
  const context = store(s => s.contexts.find(c => c.id === tab.id))
  const location = context ? selectCurrentLocation(context) : null
  const route = location ? registry[location.routeId] : undefined

  if (!context || !location || !route) {
    return null
  }

  const frame = (
    <ActivityTabFrame
      tab={tab}
      context={context}
      visible={active}
      onSaveScrollPositions={onSaveScrollPositions}
    >
      <TabFrameActiveContext value={active}>
        <RetainedTabRouteContent
          tab={tab}
          route={route}
          fallback={fallback}
          wrapper={Wrapper}
        />
      </TabFrameActiveContext>
    </ActivityTabFrame>
  )

  if (context.keepAlive === 'discardable') {
    return (
      <Activity name={`tab:${tab.id}`} mode={active ? 'visible' : 'hidden'}>
        {frame}
      </Activity>
    )
  }

  return frame
})

const RetainedTabRouteContent = memo(({
  tab,
  route,
  fallback,
  wrapper: Wrapper,
}: {
  tab: TabInstance
  route: TabRouteDefinition
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
}) => {
  return Wrapper
    ? (
      <Wrapper>
        <TabRouteContent tab={tab} route={route} fallback={fallback} />
      </Wrapper>
    )
    : <TabRouteContent tab={tab} route={route} fallback={fallback} />
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
  fallback?: React.ReactNode
}

function TabRouteContent({ tab, route, fallback }: TabRouteContentProps) {
  'use no memo'
  const Component = route.component

  if (!route.loader) {
    return (
      <Suspense fallback={fallback ?? null}>
        <Component params={tab.params} />
      </Suspense>
    )
  }

  return <RouteLoaderBoundary tab={tab} route={route} suspenseFallback={fallback} />
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
  suspenseFallback,
}: {
  tab: TabInstance
  route: TabRouteDefinition
  suspenseFallback?: React.ReactNode
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
    </Suspense>
  )
}
