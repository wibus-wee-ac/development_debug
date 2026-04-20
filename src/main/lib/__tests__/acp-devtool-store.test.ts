// Input: Vitest, Electron WebContents mock, AcpDevtoolStore
// Output: Unit tests for ACP devtool buffering and subscriber delivery
// Position: Unit test file for src/main/lib/acp-devtool-store.ts

import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { AcpDevtoolStore } from '../acp-devtool-store'

function createStoreEvent(id: string, stream: 'stdout' | 'stderr' | 'lifecycle') {
  return {
    id,
    timestamp: 100,
    agentId: 'claude-acp',
    pid: 12345,
    kind: stream === 'lifecycle' ? 'spawn' : 'output',
    stream,
    text: `${stream}:${id}`,
    exitCode: null,
    signal: null,
  } as const
}

describe('acpDevtoolStore', () => {
  it('keeps only the newest events and broadcasts them to subscribers', () => {
    const send = vi.fn()
    const subscriber = {
      isDestroyed: vi.fn().mockReturnValue(false),
      send,
      once: vi.fn(),
    } as unknown as WebContents

    const store = new AcpDevtoolStore({ maxEvents: 2 })
    store.subscribe(subscriber)

    store.record(createStoreEvent('evt-1', 'lifecycle'))
    store.record(createStoreEvent('evt-2', 'stdout'))
    store.record(createStoreEvent('evt-3', 'stderr'))

    expect(store.getSnapshot().map(event => event.id)).toEqual(['evt-2', 'evt-3'])
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith(
      'acp-devtool:event',
      expect.objectContaining({ id: 'evt-3', stream: 'stderr' }),
    )
  })
})
