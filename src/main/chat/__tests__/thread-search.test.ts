// Input: Mocked DB rows, mocked timeline text helper, and thread search engine
// Output: Regression test proving legacy fallback search reads assistant text from timeline events
// Position: Chat feature regression guard for search behavior after UIMessage snapshot removal

import { describe, expect, it, vi } from 'vitest'

import { messages, sessions, workspaces } from '../../db/schema'

const sessionRows = [{
  id: 'session-1',
  workspaceId: 'ws-1',
  title: 'Timeline Search Session',
  agentProfileId: 'profile-1',
  agentId: null,
  linkedIssueId: null,
  pinned: 0,
  createdAt: 1,
  updatedAt: 1,
}]

const workspaceRows = [{
  id: 'ws-1',
  name: 'Workspace',
  path: '/tmp/workspace',
  createdAt: 1,
  updatedAt: 1,
}]

const messageRows = [
  {
    id: 'user-msg-1',
    sessionId: 'session-1',
    role: 'user' as const,
    status: 'complete' as const,
    content: 'please remember timeline assistant text',
    errorText: null,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'assistant-msg-1',
    sessionId: 'session-1',
    role: 'assistant' as const,
    status: 'complete' as const,
    content: '',
    errorText: null,
    createdAt: 2,
    updatedAt: 2,
  },
]

const fakeDb = {
  all: vi.fn(() => []),
  select: vi.fn(() => ({
    from(table: unknown) {
      return {
        where() {
          return this
        },
        orderBy() {
          return this
        },
        all() {
          if (table === sessions) {
            return sessionRows
          }
          if (table === workspaces) {
            return workspaceRows
          }
          if (table === messages) {
            return messageRows
          }
          return []
        },
        get() {
          return undefined
        },
      }
    },
  })),
}

vi.mock('@node-rs/jieba', () => {
  class FakeJieba {
    cutForSearch(text: string) {
      return [text]
    }

    static withDict() {
      return new FakeJieba()
    }
  }

  return { Jieba: FakeJieba }
})

vi.mock('@node-rs/jieba/dict', () => ({ dict: {} }))

vi.mock('../../db', () => ({
  getDb: () => fakeDb,
}))

vi.mock('../timeline-query', () => ({
  extractAssistantTextByMessageId: (_db: unknown, messageId: string) => messageId === 'assistant-msg-1'
    ? 'timeline-only answer'
    : '',
}))

describe('threadSearchEngine', () => {
  it('falls back to timeline-derived assistant text when FTS has no rows', async () => {
    const { threadSearchEngine } = await import('../thread-search')

    const hits = threadSearchEngine.search({ query: 'timeline-only answer' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.snippets).toEqual([
      expect.objectContaining({
        messageId: 'assistant-msg-1',
        messageRole: 'assistant',
        text: expect.stringContaining('timeline-only answer'),
      }),
    ])
  })
})