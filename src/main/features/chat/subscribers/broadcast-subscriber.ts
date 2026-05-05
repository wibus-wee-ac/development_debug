// Input: Domain event bus, renderer WebContents session/global watcher registries
// Output: Event subscriber that pushes timeline events to renderer windows via IPC
// Position: Chat feature subscriber — decouples broadcast from the core turn loop

import { observePush } from '@cradle/ipc'
import type { WebContents } from 'electron'

import type { ChatSessionActivityPayload, ChatTimelineEventPayload } from '../../../../shared/chat-events'
import type { DomainEventBus } from '../../../events/domain-event-bus'

export interface BroadcastSubscriberDeps {
  eventBus: DomainEventBus
  getSessionWatchers: () => Map<string, Map<WebContents, number>>
  getGlobalSubscribers: () => Set<WebContents>
  detachWebContents: (wc: WebContents) => void
}

export function createBroadcastSubscriber(deps: BroadcastSubscriberDeps): () => void {
  const { eventBus, getSessionWatchers, getGlobalSubscribers, detachWebContents } = deps

  return eventBus.subscribe('chat.timeline-event-persisted', (event) => {
    const { chatSessionId, messageId, event: timelineEvent, chunks, terminal } = event.payload

    // Push timeline event to session watchers
    const payload: ChatTimelineEventPayload = {
      chatSessionId,
      messageId,
      event: timelineEvent,
      chunks,
    }
    broadcastToSession(
      'chat:timeline-event',
      chatSessionId,
      payload,
      getSessionWatchers(),
      detachWebContents,
    )

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
      broadcastToGlobal(
        'chat:session-activity',
        activityPayload,
        getGlobalSubscribers(),
        detachWebContents,
      )
    }
  })
}

function broadcastToSession<T extends { chatSessionId: string }>(
  channel: string,
  chatSessionId: string,
  payload: T,
  sessionWatchers: Map<string, Map<WebContents, number>>,
  detachWebContents: (wc: WebContents) => void,
): void {
  observePush(channel, payload, { flowId: payload.chatSessionId })

  const watchers = sessionWatchers.get(chatSessionId)
  if (!watchers) {
    return
  }

  for (const wc of [...watchers.keys()]) {
    if (wc.isDestroyed()) {
      detachWebContents(wc)
      continue
    }
    try {
      wc.send(channel, payload)
    }
    catch {
      detachWebContents(wc)
    }
  }
}

function broadcastToGlobal<T extends { chatSessionId: string }>(
  channel: string,
  payload: T,
  globalSubscribers: Set<WebContents>,
  detachWebContents: (wc: WebContents) => void,
): void {
  observePush(channel, payload, { flowId: payload.chatSessionId })

  for (const wc of [...globalSubscribers]) {
    if (wc.isDestroyed()) {
      detachWebContents(wc)
      continue
    }
    try {
      wc.send(channel, payload)
    }
    catch {
      detachWebContents(wc)
    }
  }
}
