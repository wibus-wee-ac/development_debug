// Input: Domain event bus, DB accessor for usage_logs
// Output: Event subscriber that persists token usage after successful turns
// Position: Chat feature subscriber — decouples cost tracking from the turn loop

import { randomUUID } from 'node:crypto'

import type { getDb } from '@main/db'

import { usageLogs } from '../db/schema'
import type { DomainEventBus } from '../events/domain-event-bus'

type DrizzleDb = ReturnType<typeof getDb>

export interface UsageSubscriberDeps {
  eventBus: DomainEventBus
  db: DrizzleDb
}

/**
 * Subscribes to chat.message-completed events and logs token usage.
 * Usage data is delivered directly on the domain event payload.
 */
export function createUsageSubscriber(deps: UsageSubscriberDeps): () => void {
  const { eventBus, db } = deps

  return eventBus.subscribe('chat.message-completed', (event) => {
    const { chatSessionId, messageId, status, agentProfileId, modelId, usage } = event.payload

    if (status !== 'complete' || !usage) {
      return
    }

    setImmediate(() => {
      try {
        db.insert(usageLogs).values({
          id: randomUUID(),
          sessionId: chatSessionId,
          messageId,
          agentProfileId,
          modelId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        }).run()
      }
      catch (err) {
        console.error('[UsageSubscriber] usage log insert failed:', err)
      }
    })
  })
}
