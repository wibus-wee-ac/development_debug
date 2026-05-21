import type { DebugApi, DebugState } from '@cradle/tabs-next'
import {
  DEBUG_CHANNEL_NAME,
  DEBUG_COMMAND_CHANNEL_NAME,
  DEBUG_STORAGE_KEY,
} from '@cradle/tabs-next'
import { create } from 'zustand'

interface TabsDebugStore {
  connected: boolean
  debugState: DebugState | null
  lastMessageAt: number | null
  refresh: () => void
  resetMetrics: () => void
}

function readDebugApi(): DebugApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.__CRADLE_TABS_DEBUG__
}

function isDebugState(value: unknown): value is DebugState {
  if (!value || typeof value !== 'object') {
    return false
  }
  const state = value as Partial<DebugState>
  return (
    !!state.snapshot
    && typeof state.snapshot === 'object'
    && !!state.metrics
    && typeof state.metrics === 'object'
    && typeof state.updatedAt === 'number'
  )
}

function readCachedState(): DebugState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const cached = window.localStorage.getItem(DEBUG_STORAGE_KEY)
    if (!cached) {
      return null
    }
    const parsed: unknown = JSON.parse(cached)
    return isDebugState(parsed) ? parsed : null
  }
  catch {
    return null
  }
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
      if (event.data?.type === 'state' && isDebugState(event.data.state)) {
        applyDebugState(event.data.state, true)
      }
    }
  }

  return () => {
    unsubscribeApi?.()
    channel?.close()
  }
}
