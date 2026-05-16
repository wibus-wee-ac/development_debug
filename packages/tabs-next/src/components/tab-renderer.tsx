/* eslint-disable react-refresh/only-export-components */

// Input: tabs-next context, React Activity, route registry
// Output: TabRenderer with pluggable render policies
// Position: Runtime renderer for active and retained tab navigation contexts

import { Activity, Profiler, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useTabsContext } from '../context'
import { recordRendererCommit, recordRendererDuration, setMountedIdsSource, setRenderPolicySource } from '../debug'
import { selectCurrentLocation } from '../store'
import type { TabContextState, TabInstance, TabRenderPolicy, TabRouteDefinition } from '../types'

export interface TabRendererProps {
  fallback?: React.ReactNode
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  className?: string
  policy?: TabRenderPolicy
}

const DEFAULT_POLICY: TabRenderPolicy = {
  strategy: 'activity-pool',
  maxMountedTabs: 5,
  keepPinnedMounted: true,
}

const SCROLL_VIEW_STATE_KEY = 'tabs-next:scroll-positions'
const MAX_SCROLL_POSITIONS = 64

interface ScrollPosition {
  key: string
  left: number
  top: number
}

export function chooseMountedTabIds(
  tabs: TabInstance[],
  contexts: TabContextState[],
  activeTabId: string | null,
  policy: TabRenderPolicy = DEFAULT_POLICY,
): string[] {
  if (!activeTabId) {
    return []
  }

  if (policy.strategy === 'single') {
    return tabs.some(tab => tab.id === activeTabId) ? [activeTabId] : []
  }

  const maxMountedTabs = Math.max(1, policy.maxMountedTabs ?? 5)
  const contextById = new Map(contexts.map(context => [context.id, context]))
  const mounted = new Set<string>([activeTabId])

  if (policy.keepPinnedMounted !== false) {
    for (const tab of tabs) {
      const context = contextById.get(tab.id)
      if (tab.pinned || context?.keepAlive === 'always') {
        mounted.add(tab.id)
      }
    }
  }

  const candidates: Array<{ tab: TabInstance, context: TabContextState | undefined }> = []
  for (const tab of tabs) {
    if (mounted.has(tab.id)) {
      continue
    }
    const context = contextById.get(tab.id)
    if (context?.keepAlive === 'discardable') {
      continue
    }
    candidates.push({ tab, context })
  }
  candidates.sort((a, b) => (b.context?.lastActiveAt ?? 0) - (a.context?.lastActiveAt ?? 0))

  for (const candidate of candidates) {
    if (mounted.size >= maxMountedTabs) {
      break
    }
    mounted.add(candidate.tab.id)
  }

  const mountedIds: string[] = []
  for (const tab of tabs) {
    if (mounted.has(tab.id)) {
      mountedIds.push(tab.id)
    }
  }
  return mountedIds
}

export function TabRenderer({ fallback, wrapper: Wrapper, className, policy = DEFAULT_POLICY }: TabRendererProps) {
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

  return (
    <Profiler id="tabs-next-renderer" onRender={handleProfilerRender}>
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

          return (
            <Activity key={tab.id} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
              {content}
            </Activity>
          )
        })}
      </div>
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
    () => readScrollPositions(context.viewState[SCROLL_VIEW_STATE_KEY]),
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
      data-testid={`tab-content-${tab.id}`}
      data-tab-visible={visible ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}

function readScrollPositions(value: unknown): ScrollPosition[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is ScrollPosition => {
    if (!item || typeof item !== 'object') {
      return false
    }
    const candidate = item as Partial<ScrollPosition>
    return (
      typeof candidate.key === 'string'
      && typeof candidate.left === 'number'
      && typeof candidate.top === 'number'
    )
  })
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
  const [state, setState] = useState<LoaderState>({
    status: 'idle',
    data: undefined,
    error: undefined,
    paramsKey: '',
  })
  const currentParamsKey = serializeParams(tab.params)
  const loader = route.loader

  useEffect(() => {
    if (!loader) {
      return
    }

    let cancelled = false
    setState({ status: 'loading', data: undefined, error: undefined, paramsKey: currentParamsKey })
    loader(tab.params).then(
      (data) => {
        if (!cancelled) {
          setState({ status: 'success', data, error: undefined, paramsKey: currentParamsKey })
        }
      },
      (error) => {
        if (!cancelled) {
          setState({ status: 'error', data: undefined, error, paramsKey: currentParamsKey })
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
