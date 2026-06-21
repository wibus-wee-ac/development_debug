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

  it('projects raw Codex image generation response items into metadata and file content', () => {
    const state = createCodexAppServerMapperState('text-1')
    const item = {
      type: 'image_generation_call',
      id: 'raw-img-1',
      status: 'completed',
      revised_prompt: 'A calm interface',
      result: 'raw-image-data',
    }

    expect(mapCodexAppServerNotificationToChunks({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item,
      },
    }, state)).toEqual([
      {
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
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,raw-image-data',
      },
    ])
  })

  it('projects Codex image generation items as tool output and renderable file content', () => {
    const state = createCodexAppServerMapperState('text-1')
    const imageUrl = 'data:image/png;base64,generated-image'

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'img-1',
          type: 'imageGeneration',
          status: 'in_progress',
          revisedPrompt: 'A calm interface',
          result: '',
        },
      },
    }, state)).toEqual([
      { type: 'tool-input-start', toolCallId: 'img-1', toolName: 'image_generation' },
      {
        type: 'tool-input-available',
        toolCallId: 'img-1',
        toolName: 'image_generation',
        input: {
          type: 'cradle.builtin-tool-call.input.v1',
          identifier: 'codex',
          apiName: 'image_generation',
          args: {
            status: 'in_progress',
            revisedPrompt: 'A calm interface',
          },
        },
      },
    ])

    expect(mapCodexAppServerNotificationToChunks({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'img-1',
          type: 'imageGeneration',
          status: 'completed',
          revisedPrompt: 'A calm interface',
          result: imageUrl,
        },
      },
    }, state)).toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'img-1',
        output: {
          type: 'cradle.builtin-tool-call.result.v1',
          identifier: 'codex',
          apiName: 'image_generation',
          args: {
            status: 'in_progress',
            revisedPrompt: 'A calm interface',
          },
          result: {
            status: 'completed',
            revisedPrompt: 'A calm interface',
            result: imageUrl,
            savedPath: null,
          },
        },
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: imageUrl,
      },
    ])
  })

})
