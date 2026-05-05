// Input: Electron WebContents, PushEventMap from shared/push-events
// Output: SignalBroadcaster — single broadcast gateway for all main→renderer push
// Position: Main-process infrastructure — replaces per-feature broadcast plumbing

import { observePush } from '@cradle/ipc'
import type { WebContents } from 'electron'

import type { PushEventMap, PushTopic } from '../../shared/push-events'

export interface SignalBroadcaster {
  /** Broadcast to all globally registered renderers */
  broadcastGlobal: <T extends PushTopic>(topic: T, payload: PushEventMap[T]) => void
  /** Broadcast to a filtered subset of renderers */
  broadcastFiltered: <T extends PushTopic>(
    topic: T,
    payload: PushEventMap[T],
    predicate: (wc: WebContents) => boolean,
  ) => void
  /** Register a renderer for global broadcasts */
  subscribe: (wc: WebContents) => () => void
}

const SIGNAL_CHANNEL = 'cradle:signal'

export function createSignalBroadcaster(): SignalBroadcaster {
  const subscribers = new Set<WebContents>()

  function cleanupDestroyed(wc: WebContents): boolean {
    if (wc.isDestroyed()) {
      subscribers.delete(wc)
      return true
    }
    return false
  }

  function send(wc: WebContents, topic: PushTopic, payload: unknown): void {
    if (cleanupDestroyed(wc)) {
      return
    }
    try {
      wc.send(SIGNAL_CHANNEL, topic, payload)
    }
    catch {
      subscribers.delete(wc)
    }
  }

  const broadcastGlobal: SignalBroadcaster['broadcastGlobal'] = (topic, payload) => {
    observePush(topic, payload as unknown as Record<string, unknown>)
    for (const wc of [...subscribers]) {
      send(wc, topic, payload)
    }
  }

  const broadcastFiltered: SignalBroadcaster['broadcastFiltered'] = (topic, payload, predicate) => {
    observePush(topic, payload as unknown as Record<string, unknown>)
    for (const wc of [...subscribers]) {
      if (cleanupDestroyed(wc)) {
        continue
      }
      if (predicate(wc)) {
        send(wc, topic, payload)
      }
    }
  }

  const subscribe: SignalBroadcaster['subscribe'] = (wc) => {
    subscribers.add(wc)
    wc.once('destroyed', () => {
      subscribers.delete(wc)
    })
    return () => {
      subscribers.delete(wc)
    }
  }

  return { broadcastGlobal, broadcastFiltered, subscribe }
}

// ── Singleton access ──────────────────────────────────────────────────────────

let _instance: SignalBroadcaster | null = null

export function initSignalBroadcaster(): SignalBroadcaster {
  _instance = createSignalBroadcaster()
  return _instance
}

export function getSignalBroadcaster(): SignalBroadcaster {
  if (!_instance) {
    throw new Error('SignalBroadcaster not initialized. Call initSignalBroadcaster() first.')
  }
  return _instance
}

export { SIGNAL_CHANNEL }
