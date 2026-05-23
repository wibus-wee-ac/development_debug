import type { ServerStatusEvent } from './model'

type Subscriber = (event: ServerStatusEvent) => void

class ServerEventBus {
  private subscribers = new Set<Subscriber>()

  publish(event: ServerStatusEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event)
      }
      catch {
        // subscriber errors should not break the bus
      }
    }
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }
}

export const serverEventBus = new ServerEventBus()
