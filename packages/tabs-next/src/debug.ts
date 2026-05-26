import type { TabContextState, TabInstance } from './types'

export const DEBUG_CHANNEL_NAME = 'cradle:tabs-next-debug'
export const DEBUG_COMMAND_CHANNEL_NAME = 'cradle:tabs-next-debug:commands'
export const DEBUG_STORAGE_KEY = 'cradle:tabs-next:debug:last'

type DebugAction = 'activate' | 'close' | 'create' | 'navigate' | 'open'

interface DebugStoreState {
  tabs: TabInstance[]
  contexts: TabContextState[]
  activeTabId: string | null
}

export interface DebugSnapshot {
  tabCount: number
  contextCount: number
  activityTabIds: string[]
  activeTabId: string | null
  tabs: Array<{ id: string, type: string, pinned: boolean, label: string }>
  contexts: Array<{ id: string, historyLen: number, index: number, keepAlive: string, viewStateKeys: string[] }>
}

export interface DebugMetrics {
  createCount: number
  openCount: number
  activateCount: number
  closeCount: number
  navigateCount: number
  rendererCommitCount: number
  rendererDurationTotal: number
  rendererDurationRecent: number
}

export interface DebugState {
  snapshot: DebugSnapshot
  metrics: DebugMetrics
  updatedAt: number
}

export interface DebugApi {
  snapshot: () => DebugSnapshot
  metrics: () => DebugMetrics
  state: () => DebugState
  resetMetrics: () => void
  subscribe: (listener: (state: DebugState) => void) => () => void
}

declare global {
  interface Window {
    __CRADLE_TABS_DEBUG__?: DebugApi
    __CRADLE_TABS_PROFILE_RENDERER__?: boolean
  }
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

let activityIdsRef: () => string[] = () => []
let stateRef: (() => DebugState) | null = null
let publishChannel: BroadcastChannel | null = null
let commandChannel: BroadcastChannel | null = null
let publishScheduled = false
let lastStorageWriteAt = 0

const listeners = new Set<(state: DebugState) => void>()

export function setActivityIdsSource(fn: () => string[]) {
  activityIdsRef = fn
  notifyDebugStateChanged()
}

export function recordTabAction(action: DebugAction) {
  switch (action) {
    case 'activate':
      metrics.activateCount += 1
      break
    case 'close':
      metrics.closeCount += 1
      break
    case 'create':
      metrics.createCount += 1
      break
    case 'navigate':
      metrics.navigateCount += 1
      break
    case 'open':
      metrics.openCount += 1
      break
  }
  notifyDebugStateChanged()
}

export function recordRendererCommit() {
  metrics.rendererCommitCount += 1
  notifyDebugStateChanged()
}

export function recordRendererDuration(duration: number) {
  metrics.rendererDurationRecent = duration
  metrics.rendererDurationTotal += duration
  notifyDebugStateChanged()
}

export function notifyDebugStateChanged() {
  if (!stateRef) {
    return
  }

  if (publishScheduled) {
    return
  }
  publishScheduled = true

  const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? (callback: FrameRequestCallback) => window.requestAnimationFrame(callback)
    : (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0)

  schedule(() => {
    publishScheduled = false
    const state = stateRef?.()
    if (state) {
      publishDebugState(state)
    }
  })
}

function readMetrics(): DebugMetrics {
  return { ...metrics }
}

function resetMetricsValues() {
  metrics.createCount = 0
  metrics.openCount = 0
  metrics.activateCount = 0
  metrics.closeCount = 0
  metrics.navigateCount = 0
  metrics.rendererCommitCount = 0
  metrics.rendererDurationTotal = 0
  metrics.rendererDurationRecent = 0
}

function publishDebugState(state: DebugState) {
  for (const listener of listeners) {
    listener(state)
  }

  if (typeof window === 'undefined') {
    return
  }

  const now = Date.now()
  if (now - lastStorageWriteAt > 1_000) {
    try {
      window.localStorage.setItem(DEBUG_STORAGE_KEY, JSON.stringify(state))
      lastStorageWriteAt = now
    }
    catch {
      // Storage may be unavailable in restricted browser contexts.
    }
  }

  if (typeof BroadcastChannel === 'undefined') {
    return
  }

  publishChannel ??= new BroadcastChannel(DEBUG_CHANNEL_NAME)
  publishChannel.postMessage({ type: 'state', state })
}

function openCommandChannel(api: DebugApi) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined' || commandChannel) {
    return
  }

  commandChannel = new BroadcastChannel(DEBUG_COMMAND_CHANNEL_NAME)
  commandChannel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'resetMetrics') {
      api.resetMetrics()
    }
  }
}

export function installDebug(getState: () => DebugStoreState) {
  if (typeof window === 'undefined') {
    return
  }

  const readSnapshot = (): DebugSnapshot => {
    const s = getState()
    return {
      tabCount: s.tabs.length,
      contextCount: s.contexts.length,
      activityTabIds: activityIdsRef(),
      activeTabId: s.activeTabId,
      tabs: s.tabs.map(t => ({ id: t.id, type: t.type, pinned: t.pinned, label: t.label })),
      contexts: s.contexts.map(c => ({
        id: c.id,
        historyLen: c.history.length,
        index: c.index,
        keepAlive: c.keepAlive,
        viewStateKeys: Object.keys(c.viewState),
      })),
    }
  }

  const readState = (): DebugState => ({
    snapshot: readSnapshot(),
    metrics: readMetrics(),
    updatedAt: Date.now(),
  })

  const api: DebugApi = {
    snapshot(): DebugSnapshot {
      return readSnapshot()
    },
    metrics(): DebugMetrics {
      return readMetrics()
    },
    state(): DebugState {
      return readState()
    },
    resetMetrics() {
      resetMetricsValues()
      notifyDebugStateChanged()
    },
    subscribe(listener: (state: DebugState) => void) {
      listeners.add(listener)
      listener(readState())
      return () => {
        listeners.delete(listener)
      }
    },
  }

  stateRef = readState
  window.__CRADLE_TABS_DEBUG__ = api
  openCommandChannel(api)
  notifyDebugStateChanged()
}
