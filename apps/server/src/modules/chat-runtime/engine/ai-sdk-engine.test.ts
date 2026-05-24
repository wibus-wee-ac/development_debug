/**
 * Output: Regression coverage for chat runtime AI SDK message conversion.
 * Input: UIMessage history and user file parts.
 * Position: Chat runtime engine tests for provider-ready ModelMessage construction.
 */

import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import { buildModelMessages } from './ai-sdk-engine'

describe('buildModelMessages', () => {
  it('preserves user file parts when building AI SDK model messages', async () => {
    const userMessage: UIMessage = {
      id: 'user-with-file',
      role: 'user',
      parts: [
        { type: 'text', text: 'Read this image' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'diagram.png',
          url: 'data:image/png;base64,test',
        },
      ],
    }

    await expect(buildModelMessages(undefined, userMessage)).resolves.toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this image' },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'diagram.png',
            data: 'data:image/png;base64,test',
          },
        ],
      },
    ])
  })
})
