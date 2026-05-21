import { describe, expect, it } from 'vitest'

import type { ThreadSearchHit } from '~/lib/types'

import { groupHitsByWorkspace } from './thread-search-groups'

function createHit(overrides: Partial<ThreadSearchHit>): ThreadSearchHit {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace Alpha',
    sessionTitle: 'Deploy failure',
    titleRanges: [],
    snippets: [],
    matchCount: 1,
    score: 10,
    updatedAt: 1_700_000_000,
    ...overrides,
  }
}

describe('groupHitsByWorkspace', () => {
  it('returns Base UI group items with value, label, and items fields', () => {
    const groups = groupHitsByWorkspace([
      createHit({ sessionId: 'session-1' }),
      createHit({ sessionId: 'session-2' }),
    ])

    expect(groups).toEqual([
      {
        value: 'workspace-1',
        label: 'Workspace Alpha',
        items: [
          expect.objectContaining({ sessionId: 'session-1' }),
          expect.objectContaining({ sessionId: 'session-2' }),
        ],
      },
    ])
  })

  it('falls back to a stable label when workspaceName is missing', () => {
    const groups = groupHitsByWorkspace([
      createHit({
        workspaceId: 'workspace-2',
        workspaceName: null,
      }),
    ])

    expect(groups[0]).toMatchObject({
      value: 'workspace-2',
      label: 'Untitled workspace',
    })
    expect(groups[0].items).toHaveLength(1)
  })
})
