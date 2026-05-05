// Input: main-process Drizzle schema exports and table metadata helpers
// Output: Regression tests for append-only backend timeline schema ownership
// Position: Schema-level guardrail for the breaking timeline rewrite in backend control plane

import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../schema'

describe('backend timeline schema', () => {
  it('exports append-only backend timeline events', () => {
    expect(schema.backendTimelineEvents).toBeDefined()
  })

  it('stores typed event rows keyed by run ownership and sequence ordering', () => {
    const columns = Object.keys(getTableColumns(schema.backendTimelineEvents))

    expect(columns).toEqual(expect.arrayContaining([
      'id',
      'runId',
      'chatSessionId',
      'sequenceNumber',
      'eventType',
      'schemaVersion',
      'payloadJson',
      'sourceJson',
      'createdAt',
    ]))
  })
})