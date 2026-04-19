// Input: Vitest, Electron IPC mocks, @cradle/ipc shared helpers, future IPC devtool store
// Output: Regression tests for IPC devtool backend instrumentation and buffering
// Position: Main-process test suite covering shared IPC instrumentation and backend storage

import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createStoreEvent(id: string, channel: string, status: 'pending' | 'success' | 'error') {
  return {
    id,
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    parentSpanId: null,
    channel,
    side: 'main' as const,
    phase: 'finish' as const,
    status,
    startedAt: 100,
    endedAt: 120,
    durationMs: 20,
    args: null,
    result: null,
    error: null,
    callerStack: [],
  }
}

const registeredHandlers = new Map<
  string,
  (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
      ) => {
        registeredHandlers.set(channel, handler)
      },
    ),
  },
}))

describe('createIpcProxy instrumentation', () => {
  beforeEach(() => {
    vi.resetModules()
    registeredHandlers.clear()
  })

  it('emits renderer start and success events around invoke calls', async () => {
    const events: unknown[] = []
    const invoke = vi.fn().mockResolvedValue({ ok: true, rows: [{ id: 'w1' }] })

    const { createIpcProxy } = await import('@cradle/ipc')

    const ipc = createIpcProxy<{
      workspace: {
        list: () => Promise<{ ok: boolean, rows: Array<{ id: string }> }>
      }
    }>(
      { invoke },
      {
        captureStack: true,
        emit: event => events.push(event),
      },
    )

    await ipc!.workspace.list()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      side: 'renderer',
      phase: 'start',
      channel: 'workspace.list',
      status: 'pending',
    })
    expect(events[1]).toMatchObject({
      side: 'renderer',
      phase: 'finish',
      channel: 'workspace.list',
      status: 'success',
    })
  })
})

describe('main IPC instrumentation', () => {
  beforeEach(() => {
    vi.resetModules()
    registeredHandlers.clear()
  })

  it('strips metadata envelopes before calling service methods and emits main-side events', async () => {
    const events: unknown[] = []

    const ipc = await import('@cradle/ipc')

    ipc.setIpcObserver(event => events.push(event))

    class TestService extends ipc.IpcService {
      static readonly groupName = 'test'

      @ipc.IpcMethod()
      sum(left: number, right: number): number {
        return left + right
      }
    }

    ipc.createServices([TestService] as const)

    const handler = registeredHandlers.get('test.sum')
    expect(handler).toBeTypeOf('function')

    const sender = { id: 1 } as WebContents
    const result = await handler!(
      { sender } as IpcMainInvokeEvent,
      {
        __ipcDevtool: true,
        traceId: 'trace-1',
        parentId: null,
        callerStack: ['at renderer.tsx:10:1'],
        startedAt: 100,
      },
      2,
      3,
    )

    expect(result).toBe(5)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      side: 'main',
      phase: 'start',
      channel: 'test.sum',
      traceId: 'trace-1',
      status: 'pending',
    })
    expect(events[1]).toMatchObject({
      side: 'main',
      phase: 'finish',
      channel: 'test.sum',
      traceId: 'trace-1',
      status: 'success',
    })
  })
})

describe('ipcDevtoolStore', () => {
  beforeEach(() => {
    vi.resetModules()
    registeredHandlers.clear()
  })

  it('keeps only the newest events and broadcasts them to subscribers', async () => {
    const { IpcDevtoolStore } = await import('../ipc-devtool-store')

    const send = vi.fn()
    const subscriber = {
      isDestroyed: vi.fn().mockReturnValue(false),
      send,
      once: vi.fn(),
    } as unknown as WebContents

    const store = new IpcDevtoolStore({ maxEvents: 2 })
    store.subscribe(subscriber)

    store.record(createStoreEvent('evt-1', 'workspace.list', 'pending'))
    store.record(createStoreEvent('evt-2', 'workspace.get', 'success'))
    store.record(createStoreEvent('evt-3', 'session.get', 'error'))

    expect(store.getSnapshot().map(event => event.id)).toEqual(['evt-2', 'evt-3'])
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith(
      'ipc-devtool:event',
      expect.objectContaining({ id: 'evt-3' }),
    )
  })
})
