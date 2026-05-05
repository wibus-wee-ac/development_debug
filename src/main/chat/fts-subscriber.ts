// Input: Domain event bus, ThreadSearchEngine, DB accessor
// Output: Event subscriber that indexes completed messages into FTS5
// Position: Chat feature subscriber — decouples full-text search indexing from the turn loop

import type { getDb } from '@main/db'
import { eq } from 'drizzle-orm'

import { sessions } from '../db/schema'
import type { DomainEventBus } from '../events/domain-event-bus'
import type { ThreadSearchEngine } from './thread-search'

type DrizzleDb = ReturnType<typeof getDb>

export interface FtsSubscriberDeps {
  eventBus: DomainEventBus
  db: DrizzleDb
  searchEngine: ThreadSearchEngine
}

/**
 * Subscribes to chat.message-completed events and indexes successful messages.
 * Runs asynchronously (non-blocking) — FTS indexing is not in the critical path.
 */
export function createFtsSubscriber(deps: FtsSubscriberDeps): () => void {
  const { eventBus, db, searchEngine } = deps

  return eventBus.subscribe('chat.message-completed', (event) => {
    const { chatSessionId, messageId, status, assistantText } = event.payload

    if (status !== 'complete') {
      return
    }

    setImmediate(() => {
      try {
        const session = db.select().from(sessions).where(eq(sessions.id, chatSessionId)).get()
        if (session) {
          searchEngine.indexMessage(chatSessionId, session.title, messageId, assistantText)
        }
      }
      catch (err) {
        console.error('[FTSSubscriber] indexing failed:', err)
      }
    })
  })
}
