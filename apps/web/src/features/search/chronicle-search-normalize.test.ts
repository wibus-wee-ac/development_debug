import { describe, expect, it } from 'vitest'

import { ChronicleSearchHitSchema, ChronicleSearchHitsSchema } from './chronicle-search-normalize'

describe('ChronicleSearchHitSchema', () => {
  it('fills optional display fields so the command palette can render safely', () => {
    const hit = ChronicleSearchHitSchema.parse({
      type: 'memory',
      id: 'memory-1',
      title: 'Nebula checkout',
      snippet: undefined,
    })

    expect(hit.workspaceId).toBeNull()
    expect(hit.workspaceName).toBeNull()
    expect(hit.titleRanges).toEqual([])
    expect(hit.snippet).toEqual({ text: '', ranges: [] })
    expect(hit.matchCount).toBe(0)
  })

  it('rejects malformed hit identity at the boundary', () => {
    expect(() => ChronicleSearchHitSchema.parse({
      type: 'knowledge',
      id: '',
      title: 'Broken',
    })).toThrow()
  })
})

describe('ChronicleSearchHitsSchema', () => {
  it('returns an empty list for missing payloads', () => {
    expect(ChronicleSearchHitsSchema.parse(undefined)).toEqual([])
  })
})
