import { describe, expect, it } from 'vitest'

import { reduceChatSessionEvents } from './aggregate'
import type { StoredChatSessionEvent } from './events'

function event(
  version: number,
  type: StoredChatSessionEvent['type'],
  payload: StoredChatSessionEvent['payload']
): StoredChatSessionEvent {
  return {
    sequenceId: version,
    aggregateId: 'session-1',
    aggregateType: 'ChatSession',
    version,
    type,
    payload,
    occurredAt: version
  } as StoredChatSessionEvent
}

describe('reduceChatSessionEvents', () => {
  it('keeps the active run when the event stream has no terminal fact', () => {
    const state = reduceChatSessionEvents([
      event(1, 'RunStarted', {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 100,
          finishedAt: null
        },
        assistantMessage: {
          id: 'assistant-1',
          sessionId: 'session-1',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: '',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          errorText: null,
          createdAt: 100,
          updatedAt: 100
        },
        queueItemId: 'queue-1'
      })
    ])

    expect(state.version).toBe(1)
    expect(state.activeRun).toEqual({
      runId: 'run-1',
      messageId: 'assistant-1',
      queueItemId: 'queue-1',
      startedAt: 100
    })
  })

  it('clears the active run after a terminal event', () => {
    const state = reduceChatSessionEvents([
      event(1, 'RunStarted', {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 100,
          finishedAt: null
        },
        assistantMessage: null,
        queueItemId: null
      }),
      event(2, 'RunFailed', {
        runId: 'run-1',
        sessionId: 'session-1',
        queueItemId: null,
        status: 'failed',
        stopReason: 'response.interrupted',
        errorText: 'interrupted',
        finishedAt: 120
      })
    ])

    expect(state.version).toBe(2)
    expect(state.activeRun).toBeNull()
  })
})
