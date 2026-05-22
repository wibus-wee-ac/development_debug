import type { DebugApi, DebugState } from '@cradle/tabs-next'
import {
  DEBUG_CHANNEL_NAME,
  DEBUG_COMMAND_CHANNEL_NAME,
  DEBUG_STORAGE_KEY,
} from '@cradle/tabs-next'
import { create } from 'zustand'
import { z } from 'zod'

interface TabsDebugStore {
  connected: boolean
  debugState: DebugState | null
  lastMessageAt: number | null
  refresh: () => void
  resetMetrics: () => void
}

const DebugSnapshotSchema = z.object({
  tabCount: z.number(),
  contextCount: z.number(),
  mountedTabIds: z.array(z.string()),
  activeTabId: z.string().nullable(),
  renderPolicy: z.object({
    strategy: z.enum(['single', 'activity-pool']),
    maxMountedTabs: z.number().optional(),
    keepPinnedMounted: z.boolean().optional(),
  }).nullable(),
  tabs: z.array(z.object({
    id: z.string(),
    type: z.string(),
    pinned: z.boolean(),
    label: z.string(),
  })),
  contexts: z.array(z.object({
    id: z.string(),
    historyLen: z.number(),
    index: z.number(),
    keepAlive: z.string(),
    viewStateKeys: z.array(z.string()),
  })),
})

const DebugMetricsSchema = z.object({
  createCount: z.number(),
  openCount: z.number(),
  activateCount: z.number(),
  closeCount: z.number(),
  navigateCount: z.number(),
  rendererCommitCount: z.number(),
  rendererDurationTotal: z.number(),
  rendererDurationRecent: z.number(),
})

const DebugStateSchema = z.object({
  snapshot: DebugSnapshotSchema,
  metrics: DebugMetricsSchema,
  updatedAt: z.number(),
})

const DebugStateJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(DebugStateSchema)

const DebugStateMessageSchema = z.object({
  type: z.literal('state'),
  state: DebugStateSchema,
})

function readDebugApi(): DebugApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.__CRADLE_TABS_DEBUG__
}

function readCachedState(): DebugState | null {
  if (typeof window === 'undefined') {
    return null
  }

  const cached = window.localStorage.getItem(DEBUG_STORAGE_KEY)
  if (!cached) {
    return null
  }
  return DebugStateJsonSchema.parse(cached) satisfies DebugState
}

function publishResetCommand() {
  if (typeof BroadcastChannel === 'undefined') {
    return
  }

  const channel = new BroadcastChannel(DEBUG_COMMAND_CHANNEL_NAME)
  channel.postMessage({ type: 'resetMetrics' })
  globalThis.setTimeout(() => channel.close(), 0)
}

export const useTabsDebugStore = create<TabsDebugStore>(set => ({
  connected: false,
  debugState: readCachedState(),
  lastMessageAt: null,
  refresh: () => {
    const api = readDebugApi()
    const state = api?.state() ?? readCachedState()
    set({
      connected: !!api || !!state,
      debugState: state,
      lastMessageAt: state ? Date.now() : null,
    })
  },
  resetMetrics: () => {
    readDebugApi()?.resetMetrics()
    publishResetCommand()
  },
}))

function applyDebugState(state: DebugState | null, connected: boolean) {
  useTabsDebugStore.setState({
    connected,
    debugState: state,
    lastMessageAt: state ? Date.now() : null,
  })
}

export function startTabsDebugSync(): () => void {
  const api = readDebugApi()
  const cachedState = readCachedState()
  applyDebugState(api?.state() ?? cachedState, !!api || !!cachedState)

  const unsubscribeApi = api?.subscribe((state) => {
    applyDebugState(state, true)
  })

  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(DEBUG_CHANNEL_NAME)
    : null

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const message = DebugStateMessageSchema.parse(event.data)
      applyDebugState(message.state satisfies DebugState, true)
    }
  }

  return () => {
    unsubscribeApi?.()
    channel?.close()
  }
}
