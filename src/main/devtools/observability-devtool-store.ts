// Input: Electron WebContents subscribers and observability event payloads
// Output: Observability devtool singleton store and subscription helpers
// Position: Devtool capability store for local observability event streaming

import type { ObservabilityDevtoolEvent } from '@cradle/ipc'
import type { WebContents } from 'electron'

export type { ObservabilityDevtoolEvent } from '@cradle/ipc'

export const OBSERVABILITY_DEVTOOL_EVENT_CHANNEL = 'observability-devtool:event'

const DEFAULT_MAX_EVENTS = 5000

export class ObservabilityDevtoolStore {
  private readonly events: ObservabilityDevtoolEvent[] = []
  private readonly subscribers = new Set<WebContents>()
  private readonly maxEvents: number
  private readonly eventChannel: string

  constructor(maxEvents = DEFAULT_MAX_EVENTS, eventChannel = OBSERVABILITY_DEVTOOL_EVENT_CHANNEL) {
    this.maxEvents = maxEvents
    this.eventChannel = eventChannel
  }

  record(event: ObservabilityDevtoolEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    for (const subscriber of [...this.subscribers]) {
      if (subscriber.isDestroyed()) {
        this.subscribers.delete(subscriber)
        continue
      }
      try {
        subscriber.send(this.eventChannel, event)
      }
      catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  getSnapshot(): ObservabilityDevtoolEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events.length = 0
  }

  subscribe(webContents: WebContents): () => void {
    this.subscribers.add(webContents)
    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents)
    })
    return () => {
      this.subscribers.delete(webContents)
    }
  }
}

const store = new ObservabilityDevtoolStore()

export function getObservabilityDevtoolStore(): ObservabilityDevtoolStore {
  return store
}

export function subscribeObservabilityDevtool(webContents: WebContents): () => void {
  return store.subscribe(webContents)
}
