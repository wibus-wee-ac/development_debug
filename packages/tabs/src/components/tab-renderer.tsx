// Input: useTabsContext, Activity, Suspense, React, TabDefinition
// Output: TabRenderer — renders all open tabs wrapped in Activity, with optional data loaders
// Position: Main content area component managing tab visibility via React 19 Activity

import { Activity, Suspense, useEffect, useRef, useState } from 'react'

import { useTabsContext } from '../context'
import type { TabDefinition } from '../define-tab'
import type { TabInstance } from '../store'

export interface TabRendererProps {
  /** Fallback shown while a tab's component is loading (React.lazy) */
  fallback?: React.ReactNode
  /** Wrapper rendered around each tab's content (e.g. AppLayout) */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>
  /** CSS class for the outer container */
  className?: string
}

export function TabRenderer({ fallback, wrapper: Wrapper, className }: TabRendererProps) {
  'use no memo'
  const { store, registry } = useTabsContext()
  const tabs = store(s => s.tabs)
  const activeTabId = store(s => s.activeTabId)

  return (
    <div className={className ?? 'flex-1 flex overflow-hidden'} data-testid="tab-content-renderer">
      {tabs.map((tab) => {
        const def = registry[tab.type]
        if (!def) {
          return null
        }

        return (
          <Activity key={tab.id} mode={tab.id === activeTabId ? 'visible' : 'hidden'}>
            <div className="w-full" data-testid={`tab-content-${tab.id}`} data-tab-visible={tab.id === activeTabId ? 'true' : 'false'}>
              {Wrapper
                ? (
                  <Wrapper>
                    <TabContent tab={tab} def={def} fallback={fallback} />
                  </Wrapper>
                )
                : <TabContent tab={tab} def={def} fallback={fallback} />}
            </div>
          </Activity>
        )
      })}
    </div>
  )
}

// ── Per-tab content with optional loader ──────────────────────────────────────

interface TabContentProps {
  tab: TabInstance
  def: TabDefinition
  fallback?: React.ReactNode
}

function TabContent({ tab, def, fallback }: TabContentProps) {
  'use no memo'
  const Component = def.component

  if (!def.loader) {
    return (
      <Suspense fallback={fallback ?? null}>
        <Component params={tab.params} />
      </Suspense>
    )
  }

  return (
    <TabLoaderBoundary
      tab={tab}
      def={def}
      suspenseFallback={fallback}
    />
  )
}

// ── Loader boundary — manages async data loading per tab ──────────────────────

interface LoaderState {
  status: 'idle' | 'loading' | 'success' | 'error'
  data: unknown
  error: unknown
  /** Serialized params that produced the current data */
  paramsKey: string
}

function serializeParams(params: Record<string, string | undefined>): string {
  return JSON.stringify(
    Object.keys(params).sort().reduce<Record<string, string | undefined>>((acc, k) => {
      acc[k] = params[k]
      return acc
    }, {}),
  )
}

interface TabLoaderBoundaryProps {
  tab: TabInstance
  def: TabDefinition
  suspenseFallback?: React.ReactNode
}

function TabLoaderBoundary({ tab, def, suspenseFallback }: TabLoaderBoundaryProps) {
  'use no memo'
  const [state, setState] = useState<LoaderState>({
    status: 'idle',
    data: undefined,
    error: undefined,
    paramsKey: '',
  })

  const currentParamsKey = serializeParams(tab.params)
  const loaderRef = useRef(def.loader)
  loaderRef.current = def.loader

  useEffect(() => {
    if (!loaderRef.current) {
      return
    }

    // Skip if we already have data for these exact params
    if (state.status === 'success' && state.paramsKey === currentParamsKey) {
      return
    }

    let cancelled = false
    setState(prev => ({
      ...prev,
      status: 'loading',
    }))

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
  }, [currentParamsKey, tab.params])

  const Component = def.component

  if (state.status === 'idle' || state.status === 'loading') {
    return <>{def.loaderFallback ?? suspenseFallback ?? null}</>
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
