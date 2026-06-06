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

  it('degrades Cradle plugin context parts to text for AI SDK model messages', async () => {
    const userMessage: UIMessage = {
      id: 'user-with-plugin',
      role: 'user',
      parts: [
        { type: 'text', text: 'Use this' },
        {
          type: 'data-cradle-plugin',
          data: {
            type: 'data-cradle-plugin',
            pluginName: '@cradle/browser-use',
            displayName: 'Browser Use',
            description: 'Browser automation',
            routeSegment: 'browser-use',
            capabilities: [
              { id: '@cradle/browser-use:mcp.browser-use', type: 'mcp-server', layer: 'server', label: 'Browser automation MCP server' },
            ],
            mcpServers: ['browser-use'],
          },
        } as UIMessage['parts'][number],
      ],
    }

    await expect(buildModelMessages(undefined, userMessage)).resolves.toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Use this' },
          { type: 'text', text: 'Selected Cradle plugin @Browser Use. Browser automation Capabilities: mcp-server:server. MCP servers: browser-use.' },
        ],
      },
    ])
  })
})
