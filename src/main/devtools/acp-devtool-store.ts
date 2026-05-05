// Input: Electron WebContents subscribers, ACP child-process lifecycle/output events
// Output: ACP devtool singleton store and subscription helpers
// Position: Devtool capability store for ACP runtime observability in the main process

import type { AcpDevtoolEvent } from '@cradle/ipc'
import type { WebContents } from 'electron'

export type { AcpDevtoolEvent, AcpDevtoolEventKind, AcpDevtoolEventStream } from '@cradle/ipc'

export interface AcpDevtoolStoreOptions {
  maxEvents?: number
  eventChannel?: string
}

export const ACP_DEVTOOL_EVENT_CHANNEL = 'acp-devtool:event'

const DEFAULT_MAX_EVENTS = 5000

export class AcpDevtoolStore {
  private readonly events: AcpDevtoolEvent[] = []
  private readonly subscribers = new Set<WebContents>()
  private readonly maxEvents: number
  private readonly eventChannel: string

  constructor(options: AcpDevtoolStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.eventChannel = options.eventChannel ?? ACP_DEVTOOL_EVENT_CHANNEL
  }

  record(event: AcpDevtoolEvent): void {
    this.events.push(event)
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents)
    }

    for (const subscriber of [...this.subscribers]) {
      if ('isDestroyed' in subscriber && subscriber.isDestroyed()) {
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

  getSnapshot(): AcpDevtoolEvent[] {
    return [...this.events]
  }

  clear(): void {
    this.events.length = 0
  }

  subscribe(webContents: WebContents): () => void {
    this.subscribers.add(webContents)

    if ('once' in webContents) {
      webContents.once('destroyed', () => {
        this.subscribers.delete(webContents)
      })
    }

    return () => {
      this.subscribers.delete(webContents)
    }
  }
}

const store = new AcpDevtoolStore()

export function getAcpDevtoolStore(): AcpDevtoolStore {
  return store
}

export function subscribeAcpDevtool(webContents: WebContents): () => void {
  return store.subscribe(webContents)
}
