import { describe, expect, it } from 'vitest'

import { ThreadSearchHitSchema, ThreadSearchHitsSchema } from './thread-search-normalize'

describe('ThreadSearchHitSchema', () => {
  it('fills missing arrays so SessionRow can render safely', () => {
    const hit = ThreadSearchHitSchema.parse({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      sessionTitle: 'Deploy failure',
      snippets: undefined,
      titleRanges: undefined,
      updatedAt: 123,
    })

    expect(hit.titleRanges).toEqual([])
    expect(hit.snippets).toEqual([])
  })

  it('rejects malformed snippets at the boundary', () => {
    expect(() => ThreadSearchHitSchema.parse({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      sessionTitle: 'Deploy failure',
      snippets: [
        {
          messageId: '',
          messageRole: 'assistant',
          text: 'Fixed now',
          ranges: undefined,
        },
      ],
    })).toThrow()
  })

  it('strips FTS mark tags from snippets while preserving highlight ranges', () => {
    const hit = ThreadSearchHitSchema.parse({
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      sessionTitle: 'Deploy failure',
      snippets: [
        {
          messageId: 'message-1',
          messageRole: 'user',
          text: 'Alpha <mark>Beta</mark> Gamma',
          ranges: [{ start: 6, end: 10 }],
          createdAt: 42,
        },
      ],
    })

    expect(hit.snippets).toEqual([
      {
        messageId: 'message-1',
        messageRole: 'user',
        text: 'Alpha Beta Gamma',
        ranges: [{ start: 6, end: 10 }],
        createdAt: 42,
      },
    ])
  })
})

describe('ThreadSearchHitsSchema', () => {
  it('returns an empty list for missing payloads', () => {
    expect(ThreadSearchHitsSchema.parse(undefined)).toEqual([])
  })
})
