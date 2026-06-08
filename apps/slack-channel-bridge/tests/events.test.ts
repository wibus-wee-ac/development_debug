import { describe, expect, it, vi } from 'vitest'

import { handleSlackMessageEvent, retryFailedDeliveries } from '../src/slack/events'
import type { SlackBlockMessage } from '../src/slack/format'
import { createTestStore } from './test-db'

describe('handleSlackMessageEvent', () => {
  it('creates a Cradle session for the first mention and reuses it for thread replies', async () => {
    const fixture = createTestStore()
    const posts: Array<{ channel: string, threadTs: string, text: string, blocks?: SlackBlockMessage['blocks'] }> = []
    const cradle = {
      createSlackBackedSession: vi.fn(async () => ({ id: 'session_1' })),
      sendMessageAndCollectResponse: vi.fn(async () => ({
        text: 'assistant reply',
        runId: 'run_1',
        assistantMessageId: 'assistant_1',
        userMessageId: 'user_1',
      })),
    }
    const poster = {
      postMessage: vi.fn(async (message: { channel: string, threadTs: string, text: string, blocks?: SlackBlockMessage['blocks'] }) => {
        posts.push(message)
        return { ts: `${posts.length}.000` }
      }),
      addReaction: vi.fn(async () => {}),
    }

    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      await handleSlackMessageEvent({
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@B1> start this task',
          ts: '100.000',
        },
      }, {
        store: fixture.store,
        cradle,
        poster,
        botUserId: 'B1',
      })

      expect(cradle.createSlackBackedSession).toHaveBeenCalledTimes(1)
      expect(cradle.sendMessageAndCollectResponse).toHaveBeenCalledTimes(1)
      expect(await fixture.store.getThreadBinding({ teamId: 'T1', channelId: 'C1', threadTs: '100.000' })).toMatchObject({
        cradleSessionId: 'session_1',
      })
      expect(posts.at(-1)?.text).toBe('assistant reply')
      expect(posts.at(-1)?.blocks).toMatchObject([{ type: 'rich_text' }])

      await handleSlackMessageEvent({
        event_id: 'Ev2',
        team_id: 'T1',
        event: {
          type: 'message',
          channel: 'C1',
          user: 'U1',
          text: 'continue',
          ts: '101.000',
          thread_ts: '100.000',
        },
      }, {
        store: fixture.store,
        cradle,
        poster,
        botUserId: 'B1',
      })

      expect(cradle.createSlackBackedSession).toHaveBeenCalledTimes(1)
      expect(cradle.sendMessageAndCollectResponse).toHaveBeenCalledTimes(2)
    } finally {
      fixture.cleanup()
    }
  })

  it('dedupes repeated Slack events', async () => {
    const fixture = createTestStore()
    const cradle = {
      createSlackBackedSession: vi.fn(async () => ({ id: 'session_1' })),
      sendMessageAndCollectResponse: vi.fn(async () => ({
        text: 'assistant reply',
        runId: null,
        assistantMessageId: null,
        userMessageId: null,
      })),
    }
    const poster = {
      postMessage: vi.fn(async () => ({ ts: '1.000' })),
      addReaction: vi.fn(async () => {}),
    }
    const envelope = {
      event_id: 'Ev1',
      team_id: 'T1',
      event: {
        type: 'app_mention',
        channel: 'C1',
        user: 'U1',
        text: '<@B1> start this task',
        ts: '100.000',
      },
    }

    try {
      await fixture.store.setWorkspaceBinding({
        teamId: 'T1',
        channelId: 'C1',
        cradleWorkspaceId: 'workspace_1',
        boundBySlackUserId: 'U1',
      })
      await handleSlackMessageEvent(envelope, {
        store: fixture.store,
        cradle,
        poster,
        botUserId: 'B1',
      })
      await handleSlackMessageEvent(envelope, {
        store: fixture.store,
        cradle,
        poster,
        botUserId: 'B1',
      })
      expect(cradle.sendMessageAndCollectResponse).toHaveBeenCalledTimes(1)
      expect(poster.postMessage).toHaveBeenCalledTimes(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('retries failed deliveries with persisted blocks', async () => {
    const fixture = createTestStore()
    const blocks: SlackBlockMessage['blocks'] = [{
      type: 'rich_text',
      elements: [],
    }]
    const poster = {
      postMessage: vi.fn(async (_message: { channel: string, threadTs: string, text: string, blocks?: SlackBlockMessage['blocks'] }) => ({ ts: '2.000' })),
      addReaction: vi.fn(async () => {}),
    }

    try {
      const attempt = await fixture.store.createDeliveryAttempt({
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '100.000',
        cradleSessionId: 'session_1',
        messageText: 'assistant reply',
        messageBlocksJson: JSON.stringify(blocks),
      })
      await fixture.store.markDeliveryAttemptFailed(attempt.id, 'network')

      await retryFailedDeliveries({
        store: fixture.store,
        poster,
      })

      expect(poster.postMessage).toHaveBeenCalledWith({
        channel: 'C1',
        threadTs: '100.000',
        text: 'assistant reply',
        blocks,
      })
    } finally {
      fixture.cleanup()
    }
  })
})
