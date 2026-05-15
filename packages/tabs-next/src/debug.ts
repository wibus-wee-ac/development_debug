// Input: store getState, renderer state accessors
// Output: window.__CRADLE_TABS_DEBUG__ API
// Position: Dev-only runtime introspection for tabs-next

import type { TabInstance, TabContextState } from './types'

interface DebugSnapshot {
  tabCount: number
  contextCount: number
  mountedTabIds: string[]
  activeTabId: string | null
  tabs: Array<{ id: string; type: string; pinned: boolean; label: string }>
  contexts: Array<{ id: string; historyLen: number; index: number; keepAlive: string }>
}

interface DebugMetrics {
  createCount: number
  openCount: number
  activateCount: number
  closeCount: number
  navigateCount: number
  rendererCommitCount: number
  rendererDurationTotal: number
  rendererDurationRecent: number
}

// Module-scoped counters
export const metrics = {
  createCount: 0,
  openCount: 0,
  activateCount: 0,
  closeCount: 0,
  navigateCount: 0,
  rendererCommitCount: 0,
  rendererDurationTotal: 0,
  rendererDurationRecent: 0,
}

let mountedIdsRef: () => string[] = () => []
let renderPolicyRef: () => string | null = () => null

export function setMountedIdsSource(fn: () => string[]) {
  mountedIdsRef = fn
}

export function setRenderPolicySource(fn: () => string | null) {
  renderPolicyRef = fn
}

export type { DebugSnapshot, DebugMetrics }

export function installDebug(getState: () => { tabs: TabInstance[]; contexts: TabContextState[]; activeTabId: string | null }) {
  if (typeof window === 'undefined') return

  const api = {
    snapshot(): DebugSnapshot {
      const s = getState()
      return {
        tabCount: s.tabs.length,
        contextCount: s.contexts.length,
        mountedTabIds: mountedIdsRef(),
        activeTabId: s.activeTabId,
        tabs: s.tabs.map(t => ({ id: t.id, type: t.type, pinned: t.pinned, label: t.label })),
        contexts: s.contexts.map(c => ({ id: c.id, historyLen: c.history.length, index: c.index, keepAlive: c.keepAlive })),
      }
    },
    metrics(): DebugMetrics {
      return { ...metrics }
    },
    resetMetrics() {
      metrics.createCount = 0
      metrics.openCount = 0
      metrics.activateCount = 0
      metrics.closeCount = 0
      metrics.navigateCount = 0
      metrics.rendererCommitCount = 0
      metrics.rendererDurationTotal = 0
      metrics.rendererDurationRecent = 0
    },
  }

  ;(window as any).__CRADLE_TABS_DEBUG__ = api
}
