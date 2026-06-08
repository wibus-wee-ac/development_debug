import { afterEach, describe, expect, it, vi } from 'vitest'

import { printResult } from './output'

function readPrintedJson(spy: ReturnType<typeof vi.spyOn>): unknown {
  const firstCall = spy.mock.calls[0]
  expect(firstCall).toBeDefined()
  return JSON.parse(String(firstCall?.[0]))
}

describe('printResult', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects fields from array records before JSON output', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult([
      { id: 'snapshot-1', runId: 'run-1', status: 'complete', events: [{ phase: 'final' }] },
    ], {
      forceJson: true,
      format: 'json',
      jsonFields: ['id', 'runId', 'status'],
    })

    expect(readPrintedJson(logSpy)).toEqual([
      { id: 'snapshot-1', runId: 'run-1', status: 'complete' },
    ])
  })

  it('selects fields from a wrapped array when it is the best field match', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult({
      sessionId: 'session-1',
      snapshots: [
        {
          id: 'snapshot-1',
          runId: 'run-1',
          status: 'complete',
          events: [{ phase: 'final', payload: { nested: true } }],
        },
      ],
    }, {
      forceJson: true,
      format: 'json',
      jsonFields: ['id', 'runId', 'status', 'assistantMessageId'],
    })

    expect(readPrintedJson(logSpy)).toEqual([
      { id: 'snapshot-1', runId: 'run-1', status: 'complete' },
    ])
  })

  it('keeps direct record fields ahead of wrapped array fields', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult({
      id: 'session-1',
      snapshots: [{ id: 'snapshot-1' }],
    }, {
      forceJson: true,
      format: 'json',
      jsonFields: ['id'],
    })

    expect(readPrintedJson(logSpy)).toEqual({ id: 'session-1' })
  })

  it('returns an empty array for empty single-collection wrappers', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult({
      sessionId: 'session-1',
      snapshots: [],
    }, {
      forceJson: true,
      format: 'json',
      jsonFields: ['id', 'runId'],
    })

    expect(readPrintedJson(logSpy)).toEqual([])
  })
})
