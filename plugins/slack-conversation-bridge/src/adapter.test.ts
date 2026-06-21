import type { ConversationBridgeHost } from '@cradle/plugin-sdk/server'
import { describe, expect, it, vi } from 'vitest'

import {
  normalizeSlackMessageEvent,
  SlackConversationBridgeRuntime,
  type SlackAppFactory,
  type SlackAppLike,
} from './adapter'

function createFakeApp(): {
  app: SlackAppLike
  posted: Array<{ channel: string, thread_ts: string, text: string, blocks?: unknown[] }>
  handlers: Record<string, (input: { body: any }) => Promise<void>>
} {
  const posted: Array<{ channel: string, thread_ts: string, text: string, blocks?: unknown[] }> = []
  const handlers: Record<string, (input: { body: any }) => Promise<void>> = {}
  const app: SlackAppLike = {
    client: {
      auth: {
        test: async () => ({ user_id: 'UBOT', team_id: 'T1' }),
      },
      chat: {
        postMessage: async (input) => {
          posted.push(input)
          return { ts: `posted-${posted.length}` }
        },
      },
      reactions: {
        add: async () => undefined,
      },
    },
    event: (name, handler) => {
      handlers[name] = handler
    },
    start: async () => undefined,
    stop: async () => undefined,
  }
  return { app, posted, handlers }
}

describe('Slack conversation bridge adapter', () => {
  it('normalizes Slack app mentions into platform-neutral inbound messages', () => {
    const normalized = normalizeSlackMessageEvent({
      connectionId: 'connection-1',
      botUserId: 'UBOT',
      envelope: {
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@UBOT> hello from Slack',
          ts: '171.001',
        },
      },
    })

    expect(normalized).toEqual({
      connectionId: 'connection-1',
      externalEventId: 'Ev1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      externalMessageId: '171.001',
      externalActorId: 'U1',
      text: 'hello from Slack',
      mentionedAdapter: true,
      eventType: 'app_mention',
      payload: {
        slack: {
          teamId: 'T1',
          channelId: 'C1',
          messageTs: '171.001',
          threadTs: '171.001',
          eventType: 'app_mention',
          subtype: null,
        },
      },
    })
  })

  it('starts a fake Slack app and delivers messages through chat.postMessage', async () => {
    const fake = createFakeApp()
    const createApp: SlackAppFactory = (input) => {
      expect(input.logLevel).toBe('debug')
      return fake.app
    }
    const inbound = vi.fn()
    const health = vi.fn()
    const host: ConversationBridgeHost = {
      handleInboundMessage: inbound,
      reportConnectionHealth: health,
    }
    const runtime = new SlackConversationBridgeRuntime({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      sharedConfig: new Map(),
      signal: new AbortController().signal,
    }, createApp)

    await runtime.start({
      id: 'connection-1',
      platform: 'slack',
      displayName: 'Test Slack',
      config: { logLevel: 'debug' },
      secrets: {
        botToken: 'xoxb-token',
        appToken: 'xapp-token',
        signingSecret: 'signing-secret',
      },
    }, host)

    await fake.handlers.app_mention?.({
      body: {
        event_id: 'Ev2',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          user: 'U1',
          text: '<@UBOT> continue this',
          ts: '171.002',
          thread_ts: '171.001',
        },
      },
    })

    expect(inbound).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      text: 'continue this',
    }))

    const delivered = await runtime.sendMessage({
      connectionId: 'connection-1',
      externalWorkspaceId: 'T1',
      externalChannelId: 'C1',
      externalThreadId: '171.001',
      text: 'Assistant **response**',
    })

    expect(fake.posted).toHaveLength(1)
    expect(fake.posted[0]).toEqual(expect.objectContaining({
      channel: 'C1',
      thread_ts: '171.001',
      text: expect.stringContaining('Assistant'),
    }))
    expect(delivered.externalMessageId).toBe('posted-1')
    expect(health).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: 'connection-1',
      status: 'running',
    }))
  })
})
