/* eslint-disable react-refresh/only-export-components */


import { Profiler, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react'
import { z } from 'zod'

import { useTabsContext } from '../context'
import { recordRendererCommit, recordRendererDuration, setMountedIdsSource, setRenderPolicySource } from '../debug'
import { chooseMountedTabIds, DEFAULT_TAB_RENDER_POLICY } from '../renderer-policy'
import { selectCurrentLocation } from '../store'
import type { TabContextState, TabInstance, TabRenderPolicy, TabRouteDefinition } from '../types'

export interface TabRendererProps {
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  className?: string
  policy?: TabRenderPolicy
}

const SCROLL_VIEW_STATE_KEY = 'tabs-next:scroll-positions'
const MAX_SCROLL_POSITIONS = 64

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

export function TabRenderer({ fallback, wrapper: Wrapper, className, policy = DEFAULT_TAB_RENDER_POLICY }: TabRendererProps) {
  'use no memo'
  const { store, registry } = useTabsContext()
  const tabs = store(s => s.tabs)
  const contexts = store(s => s.contexts)
  const activeTabId = store(s => s.activeTabId)
  const mountedIds = chooseMountedTabIds(tabs, contexts, activeTabId, policy)
  const contextById = new Map(contexts.map(context => [context.id, context]))
  const tabById = new Map(tabs.map(tab => [tab.id, tab]))
  const saveScrollPositions = useCallback((tabId: string, positions: ScrollPosition[]) => {
    store.getState().updateTabViewState(tabId, SCROLL_VIEW_STATE_KEY, positions)
  }, [store])

  // Report mounted IDs and render policy to debug bridge on every commit
  useLayoutEffect(() => {
    recordRendererCommit()
    setMountedIdsSource(() => mountedIds)
    setRenderPolicySource(() => policy)
  })

  const handleProfilerRender: React.ComponentProps<typeof Profiler>['onRender'] = (
    _id,
    _phase,
    actualDuration,
  ) => {
    recordRendererDuration(actualDuration)
  }

  const content = (
    <div className={className ?? 'flex-1 flex overflow-hidden'} data-testid="tab-content-renderer">
      {mountedIds.map((tabId) => {
        const tab = tabById.get(tabId)
        const context = contextById.get(tabId)
        const location = context ? selectCurrentLocation(context) : null
        const route = location ? registry[location.routeId] : undefined
        if (!tab || !context || !location || !route) {
          return null
        }

        const content = (
          <RetainedTabFrame
            key={tab.id}
            tab={tab}
            context={context}
            visible={tab.id === activeTabId}
            onSaveScrollPositions={saveScrollPositions}
          >
            {Wrapper
              ? (
                <Wrapper>
                  <TabRouteContent tab={tab} route={route} fallback={fallback} />
                </Wrapper>
              )
              : <TabRouteContent tab={tab} route={route} fallback={fallback} />}
          </RetainedTabFrame>
        )

        if (policy.strategy === 'single') {
          return <div key={tab.id}>{content}</div>
        }

        return content
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

function RetainedTabFrame({
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
}) {
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
      className="w-full"
      hidden={!visible}
      aria-hidden={visible ? undefined : 'true'}
      data-testid={`tab-content-${tab.id}`}
      data-tab-visible={visible ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

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

type LoaderAction =
  | { type: 'loading', paramsKey: string }
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
