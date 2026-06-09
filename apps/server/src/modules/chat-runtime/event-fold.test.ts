import { describe, expect, it } from 'vitest'

import type { ChatRuntimeEventRecord } from './events'
import { foldChatRuntimeEvents } from './event-fold'

function event(
  seq: number,
  type: ChatRuntimeEventRecord['type'],
  overrides: Partial<ChatRuntimeEventRecord> = {},
): ChatRuntimeEventRecord {
  return {
    id: `event-${seq}`,
    streamId: 'session-1',
    seq,
    type,
    commandId: null,
    actorKind: null,
    actorId: null,
    runId: null,
    messageId: null,
    queueItemId: null,
    occurredAt: 1700000000 + seq,
    payload: {},
    ...overrides,
  }
}

describe('foldChatRuntimeEvents', () => {
  it('derives active and terminal run state from lifecycle events', () => {
    const streaming = foldChatRuntimeEvents('session-1', [
      event(1, 'assistant_message.created', { messageId: 'assistant-1', runId: 'run-1' }),
      event(2, 'run.started', { runId: 'run-1', messageId: 'assistant-1' }),
    ])

    expect(streaming.status).toBe('streaming')
    expect(streaming.activeRun).toEqual(expect.objectContaining({
      id: 'run-1',
      status: 'streaming',
      messageId: 'assistant-1',
    }))
    expect(streaming.messages.get('assistant-1')).toEqual(expect.objectContaining({
      status: 'streaming',
      runId: 'run-1',
    }))

    const terminal = foldChatRuntimeEvents('session-1', [
      event(1, 'assistant_message.created', { messageId: 'assistant-1', runId: 'run-1' }),
      event(2, 'run.started', { runId: 'run-1', messageId: 'assistant-1' }),
      event(3, 'run.failed', {
        runId: 'run-1',
        messageId: 'assistant-1',
        payload: { errorText: 'provider failed' },
      }),
    ])

    expect(terminal.status).toBe('error')
    expect(terminal.activeRun).toBeNull()
    expect(terminal.latestRun).toEqual(expect.objectContaining({
      id: 'run-1',
      status: 'failed',
      errorText: 'provider failed',
    }))
    expect(terminal.messages.get('assistant-1')).toEqual(expect.objectContaining({
      status: 'failed',
    }))
  })

  it('derives queue item lifecycle and links terminal run state to claimed queue item', () => {
    const state = foldChatRuntimeEvents('session-1', [
      event(1, 'queue.item_enqueued', {
        queueItemId: 'queue-1',
        payload: { position: 1, text: 'continue' },
      }),
      event(2, 'queue.item_claimed', {
        queueItemId: 'queue-1',
        runId: 'run-1',
      }),
      event(3, 'run.started', {
        runId: 'run-1',
        queueItemId: 'queue-1',
      }),
      event(4, 'run.completed', {
        runId: 'run-1',
        queueItemId: 'queue-1',
      }),
    ])

    expect(state.activeRun).toBeNull()
    expect(state.queue.get('queue-1')).toEqual(expect.objectContaining({
      id: 'queue-1',
      runId: 'run-1',
      status: 'completed',
      position: 1,
    }))
  })

  it('applies queue reorder events without changing queue item ownership', () => {
    const state = foldChatRuntimeEvents('session-1', [
      event(1, 'queue.item_enqueued', {
        queueItemId: 'queue-1',
        payload: { position: 1, text: 'first' },
      }),
      event(2, 'queue.item_enqueued', {
        queueItemId: 'queue-2',
        payload: { position: 2, text: 'second' },
      }),
      event(3, 'queue.item_reordered', {
        payload: {
          positions: [
            { queueItemId: 'queue-2', position: 1 },
            { queueItemId: 'queue-1', position: 2 },
          ],
        },
      }),
    ])

    expect(state.queue.get('queue-1')).toEqual(expect.objectContaining({
      status: 'pending',
      position: 2,
    }))
    expect(state.queue.get('queue-2')).toEqual(expect.objectContaining({
      status: 'pending',
      position: 1,
    }))
  })

  it('ignores events from other streams', () => {
    const state = foldChatRuntimeEvents('session-1', [
      event(1, 'run.started', { streamId: 'session-2', runId: 'run-other' }),
      event(2, 'run.started', { runId: 'run-1' }),
    ])

    expect(state.seq).toBe(2)
    expect(state.activeRun?.id).toBe('run-1')
    expect(state.runs.has('run-other')).toBe(false)
  })
})
