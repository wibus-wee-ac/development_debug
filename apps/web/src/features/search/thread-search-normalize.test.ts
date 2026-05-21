import { describe, expect, it } from 'vitest'

import { normalizeThreadSearchHit, normalizeThreadSearchHits } from './thread-search-normalize'

describe('normalizeThreadSearchHit', () => {
  it('fills missing arrays so SessionRow can render safely', () => {
    const hit = normalizeThreadSearchHit({
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

  it('normalizes malformed snippets into UI-safe values', () => {
    const hit = normalizeThreadSearchHit({
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
    })

    expect(hit.snippets).toEqual([
      {
        messageId: 'missing-message-0',
        messageRole: 'assistant',
        text: 'Fixed now',
        ranges: [],
        createdAt: 0,
      },
    ])
  })

  it('strips FTS mark tags from snippets while preserving highlight ranges', () => {
    const hit = normalizeThreadSearchHit({
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

describe('normalizeThreadSearchHits', () => {
  it('returns an empty list for missing payloads', () => {
    expect(normalizeThreadSearchHits(undefined)).toEqual([])
  })
})
