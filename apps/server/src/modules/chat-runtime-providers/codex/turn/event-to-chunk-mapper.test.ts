import { describe, expect, it } from 'vitest'

import {
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './event-to-chunk-mapper'

describe('mapCodexAppServerNotificationToChunks', () => {
  it('projects Codex moderation metadata as AI SDK message metadata', () => {
    const state = createCodexAppServerMapperState('text-1')

    expect(mapCodexAppServerNotificationToChunks({
      method: 'turn/moderationMetadata',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        metadata: { categories: { violence: false } },
      },
    }, state)).toEqual([{
      type: 'message-metadata',
      messageMetadata: {
        codex: {
          moderationMetadataByTurnId: {
            'turn-1': {
              threadId: 'thread-1',
              turnId: 'turn-1',
              metadata: { categories: { violence: false } },
            },
          },
        },
      },
    }])
  })

  it('projects raw Codex response items into message metadata', () => {
    const state = createCodexAppServerMapperState('text-1')
    const item = {
      type: 'agent_message',
      author: 'assistant',
      recipient: 'user',
      content: [{ type: 'input_text', text: 'Native agent text' }],
      metadata: { turn_id: 'turn-1' },
    }

    expect(mapCodexAppServerNotificationToChunks({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item,
      },
    }, state)).toEqual([{
      type: 'message-metadata',
      messageMetadata: {
        codex: {
          responseItems: [{
            threadId: 'thread-1',
            turnId: 'turn-1',
            item,
          }],
        },
      },
    }])
  })

})
