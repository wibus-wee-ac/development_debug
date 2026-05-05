// Input: Domain event bus, SignalBroadcaster, session watcher registry
// Output: Event subscriber that pushes timeline events to renderer via unified signal bridge
// Position: Chat feature subscriber — decouples broadcast from the core turn loop

import type { WebContents } from 'electron'

import type { ChatSessionActivityPayload, ChatTimelineEventPayload } from '../../shared/chat-events'
import type { DomainEventBus } from '../events/domain-event-bus'
import type { SignalBroadcaster } from '../signal/broadcaster'

export interface BroadcastSubscriberDeps {
  eventBus: DomainEventBus
  broadcaster: SignalBroadcaster
  getSessionWatchers: () => Map<string, Map<WebContents, number>>
}

export function createBroadcastSubscriber(deps: BroadcastSubscriberDeps): () => void {
  const { eventBus, broadcaster, getSessionWatchers } = deps

  return eventBus.subscribe('chat.timeline-event-persisted', (event) => {
    const { chatSessionId, messageId, event: timelineEvent, chunks, terminal } = event.payload

    // Push timeline event to session watchers only
    const payload: ChatTimelineEventPayload = {
      chatSessionId,
      messageId,
      event: timelineEvent,
      chunks,
    }

    const sessionWatchers = getSessionWatchers().get(chatSessionId)
    if (sessionWatchers) {
      const watcherSet = new Set(sessionWatchers.keys())
      broadcaster.broadcastFiltered('chat:timeline-event', payload, wc => watcherSet.has(wc))
    }

    // Push session activity (global) for terminal events
    if (terminal) {
      const status = timelineEvent.type === 'run.completed'
        ? 'complete'
        : timelineEvent.type === 'run.aborted'
          ? 'aborted'
          : 'failed'
      const errorText = timelineEvent.type === 'run.failed' ? timelineEvent.error : null

      const activityPayload: ChatSessionActivityPayload = {
        chatSessionId,
        messageId,
        status,
        errorText,
      }
      broadcaster.broadcastGlobal('chat:session-activity', activityPayload)
    }
  })
}
