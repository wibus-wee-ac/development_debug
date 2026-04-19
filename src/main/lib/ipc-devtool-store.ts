// Input: Electron WebContents, shared IPC observed event types
// Output: IpcDevtoolStore ring buffer with live subscriber fan-out
// Position: Main-process backend store for IPC devtool consumers

import type { WebContents } from 'electron'

import type { IpcObservedEvent } from '@cradle/ipc'

export interface IpcDevtoolStoreOptions {
  maxEvents?: number
  eventChannel?: string
}

const DEFAULT_MAX_EVENTS = 1000
const DEFAULT_EVENT_CHANNEL = 'ipc-devtool:event'

export class IpcDevtoolStore {
  private readonly events: IpcObservedEvent[] = []
  private readonly subscribers = new Set<WebContents>()
  private readonly maxEvents: number
  private readonly eventChannel: string

  constructor(options: IpcDevtoolStoreOptions = {}) {
    this.maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS
    this.eventChannel = options.eventChannel ?? DEFAULT_EVENT_CHANNEL
  }

  record(event: IpcObservedEvent): void {
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
      } catch {
        this.subscribers.delete(subscriber)
      }
    }
  }

  getSnapshot(): IpcObservedEvent[] {
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
