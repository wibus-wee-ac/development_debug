// Input: tabs-next context, React Activity, route registry
// Output: TabRenderer with pluggable render policies
// Position: Runtime renderer for active and retained tab navigation contexts

import { Activity, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useTabsContext } from '../context'
import { metrics, setMountedIdsSource, setRenderPolicySource } from '../debug'
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

  // Report mounted IDs and render policy to debug bridge on every commit
  useLayoutEffect(() => {
    metrics.rendererCommitCount++
    setMountedIdsSource(() => mountedIds)
    setRenderPolicySource(() => policy.strategy)
  })

  return (
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
          <div className="w-full" data-testid={`tab-content-${tab.id}`} data-tab-visible={tab.id === activeTabId ? 'true' : 'false'}>
            {Wrapper
              ? (
                <Wrapper>
                  <TabRouteContent tab={tab} route={route} fallback={fallback} />
                </Wrapper>
              )
              : <TabRouteContent tab={tab} route={route} fallback={fallback} />}
          </div>
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
  const loaderRef = useRef(route.loader)
  const currentParamsKey = serializeParams(tab.params)

  useEffect(() => {
    loaderRef.current = route.loader
  }, [route.loader])

  useEffect(() => {
    if (!loaderRef.current) {
      return
    }
    if (state.status === 'success' && state.paramsKey === currentParamsKey) {
      return
    }

    let cancelled = false
    setState(prev => ({ ...prev, status: 'loading' }))
    loaderRef.current(tab.params).then(
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
  }, [currentParamsKey, route, state.paramsKey, state.status, tab.params])

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
