// Input: Electron WebContents subscribers, Agent Context events from ChatEngine
// Output: Agent Context devtool singleton store and subscription helpers
// Position: Main-process backend store for Agent Context observability in the devtool

import type { AgentContextEvent } from '@cradle/ipc'
import type { WebContents } from 'electron'

export type { AgentContextEvent } from '@cradle/ipc'

export const AGENT_CONTEXT_DEVTOOL_EVENT_CHANNEL = 'agent-context-devtool:event'

const DEFAULT_MAX_EVENTS = 500

export class AgentContextDevtoolStore {
  private readonly events: AgentContextEvent[] = []
  private readonly subscribers = new Set<WebContents>()
  private readonly maxEvents: number
  private readonly eventChannel: string

  constructor(maxEvents = DEFAULT_MAX_EVENTS) {
    this.maxEvents = maxEvents
    this.eventChannel = AGENT_CONTEXT_DEVTOOL_EVENT_CHANNEL
  }

  record(event: AgentContextEvent): void {
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

  getSnapshot(): AgentContextEvent[] {
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

const store = new AgentContextDevtoolStore()

export function getAgentContextDevtoolStore(): AgentContextDevtoolStore {
  return store
}

export function subscribeAgentContextDevtool(webContents: WebContents): () => void {
  return store.subscribe(webContents)
}
