import { useEffect, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { createRoot } from 'react-dom/client'

import { TabRenderer, TabsProvider } from '../index'
import { defineTab } from '../route-definition'
import { createTabStore } from '../store'
import type { TabParams } from '../types'

declare global {
  interface Window {
    __CRADLE_TABS_PROFILE_RENDERER__?: boolean
  }
}

export interface RuntimeStressResult {
  tabCount: number
  switchCount: number
  activeTabId: string | null
  contextsStable: boolean
  renderCounts: Record<string, number>
  cleanupCount: number
  fallbackHits: number
  visibleFrames: Array<{
    id: string
    visible: string | null | undefined
    hasContent: boolean
    hasFallback: boolean
  }>
  metrics: unknown
  frameStats: {
    count: number
    max: number
    p95: number
    over16_7: number
    over33_4: number
    over50: number
    avg: number
  } | null
  setActiveStats: {
    max: number
    p95: number
    avg: number
  }
  longTasks: Array<{ start: number, duration: number, name: string }>
}

interface RuntimeStressOptions {
  host?: HTMLElement
  tabCount?: number
  switchCount?: number
  rowCount?: number
}

interface StressTabParams extends TabParams {
  label: string
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

export async function runTabsNextRuntimeStress(options: RuntimeStressOptions = {}): Promise<RuntimeStressResult> {
  const tabCount = options.tabCount ?? 8
  const switchCount = options.switchCount ?? 240
  const rowCount = options.rowCount ?? 160
  const host = options.host ?? document.createElement('div')
  const shouldRemoveHost = !options.host

  if (shouldRemoveHost) {
    host.id = 'tabs-next-stress-root'
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483640;background:#0b1020;color:white;overflow:hidden;font:12px system-ui;'
    document.body.appendChild(host)
  }

  window.__CRADLE_TABS_PROFILE_RENDERER__ = true

  const renderCounts = new Map<string, number>()
  const events: string[] = []
  const fallbackHits: number[] = []

  function StressTab({ params }: { params: StressTabParams }) {
    const label = params.label
    renderCounts.set(label, (renderCounts.get(label) ?? 0) + 1)

    useLayoutEffect(() => {
      events.push(`${label}:layout-mount`)
      return () => {
        events.push(`${label}:layout-cleanup`)
      }
    }, [label])

    useEffect(() => {
      events.push(`${label}:effect-mount`)
      return () => {
        events.push(`${label}:effect-cleanup`)
      }
    }, [label])

    const rows = []
    for (let index = 0; index < rowCount; index += 1) {
      rows.push(
        <div
          key={index}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,.08)',
            padding: '2px 6px',
          }}
        >
          <span>{`Content ${label}`}</span>
          <span>{`row ${index}`}</span>
        </div>,
      )
    }

    return (
      <div
        data-stress-content={label}
        style={{ height: '100%', overflow: 'auto', padding: 12, boxSizing: 'border-box' }}
      >
        <h1 style={{ margin: '0 0 8px', fontSize: 16 }}>{`Content ${label}`}</h1>
        {rows}
      </div>
    )
  }

  function Fallback() {
    fallbackHits.push(performance.now())
    return <div data-stress-fallback="true">Loading</div>
  }

  const registry = {
    stress: defineTab({
      type: 'stress' as const,
      label: (params: StressTabParams) => `Stress ${params.label}`,
      component: StressTab,
    }),
  }
  const store = createTabStore(registry, {
    persistKey: `tabs-next-runtime-stress-${Math.random()}`,
    crossWindowSync: false,
  })
  const tabIds = Array.from({ length: tabCount }, (_, index) => {
    return store.getState().createTab('stress', { label: `tab-${index}` })
  })
  const initialContexts = store.getState().contexts
  const root: Root = createRoot(host)

  root.render(
    <TabsProvider store={store} registry={registry}>
      <TabRenderer fallback={<Fallback />} className="h-full w-full overflow-hidden" />
    </TabsProvider>,
  )

  await nextFrame()
  await nextFrame()
  window.__CRADLE_TABS_DEBUG__?.resetMetrics?.()

  const longTasks: Array<{ start: number, duration: number, name: string }> = []
  let observer: PerformanceObserver | null = null
  if ('PerformanceObserver' in window) {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name })
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    }
    catch {
      observer = null
    }
  }

  const frameIntervals: number[] = []
  const setActiveDurations: number[] = []
  let previousFrameTime: number | null = null
  for (let index = 0; index < switchCount; index += 1) {
    await new Promise<void>(resolve => requestAnimationFrame((time) => {
      if (previousFrameTime !== null) {
        frameIntervals.push(time - previousFrameTime)
      }
      previousFrameTime = time
      const startedAt = performance.now()
      store.getState().setActiveTab(tabIds[index % tabIds.length])
      setActiveDurations.push(performance.now() - startedAt)
      resolve()
    }))
  }

  await nextFrame()
  await nextFrame()
  observer?.disconnect()

  const finalState = store.getState()
  const visibleFrames = tabIds.map((id) => {
    const frame = host.querySelector(`[data-testid="tab-content-${id}"]`)
    return {
      id,
      visible: frame?.getAttribute('data-tab-visible'),
      hasContent: !!frame?.querySelector('[data-stress-content]'),
      hasFallback: !!frame?.querySelector('[data-stress-fallback]'),
    }
  })
  const cleanupCount = events.filter(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup')).length
  const frameStats = frameIntervals.length > 0
    ? {
        count: frameIntervals.length,
        max: Math.max(...frameIntervals),
        p95: percentile(frameIntervals, 0.95),
        over16_7: frameIntervals.filter(value => value > 16.7).length,
        over33_4: frameIntervals.filter(value => value > 33.4).length,
        over50: frameIntervals.filter(value => value > 50).length,
        avg: sum(frameIntervals) / frameIntervals.length,
      }
    : null

  const result: RuntimeStressResult = {
    tabCount,
    switchCount,
    activeTabId: finalState.activeTabId,
    contextsStable: finalState.contexts === initialContexts,
    renderCounts: Object.fromEntries(renderCounts),
    cleanupCount,
    fallbackHits: fallbackHits.length,
    visibleFrames,
    metrics: window.__CRADLE_TABS_DEBUG__?.metrics?.() ?? null,
    frameStats,
    setActiveStats: {
      max: Math.max(...setActiveDurations),
      p95: percentile(setActiveDurations, 0.95),
      avg: sum(setActiveDurations) / setActiveDurations.length,
    },
    longTasks,
  }

  root.unmount()
  if (shouldRemoveHost) {
    host.remove()
  }
  return result
}
