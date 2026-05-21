// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'

import { useChatSession } from './use-chat-session'

type ChatRunEventHandler = (data: {
  chatSessionId: string
  messageId: string
  event: { type: 'run.streaming' | 'run.completed' | 'run.aborted' | 'run.failed' }
}) => void

const mockedDeps = vi.hoisted(() => {
  const storeState = {
    sessionMetaMap: new Map<string, { cancelling?: boolean, locallyDriving?: boolean, passiveStatus?: string, localDriverMessageId?: string }>(),
    messagesMap: new Map<string, Array<{ id: string, role: 'user' | 'assistant', parts: unknown[] }>>(),
    subagentMessagesMap: new Map<string, Map<string, Array<unknown>>>(),
    generatingMessageIds: new Set<string>(),
    activeAbortControllers: new Map<string, AbortController>(),
    appendMessage: vi.fn(),
    setSessionMeta: vi.fn(),
    stopGeneration: vi.fn(),
    setMessages: vi.fn(),
    setPassiveStatus: vi.fn(),
    failGeneration: vi.fn(),
    setSubagentMessages: vi.fn(),
    startGeneration: vi.fn(),
    finishGeneration: vi.fn(),
  }

  return {
    storeState,
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    startChatResponse: vi.fn(),
    cancelChatResponse: vi.fn(),
    onChatRunEvent: vi.fn(() => vi.fn()),
    buildEventStreamFromResponse: vi.fn(),
  }
})

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: undefined })),
    useQueryClient: () => ({
      invalidateQueries: mockedDeps.invalidateQueries,
    }),
  }
})

vi.mock('~/store/chat', () => {
  return {
    chatSelectors: {
      messages: () => () => [],
      visibleStatus: () => () => 'idle',
      error: () => () => undefined,
    },
    useChatStore: Object.assign(
      (selector: (store: typeof mockedDeps.storeState) => unknown) => selector(mockedDeps.storeState),
      {
        getState: () => mockedDeps.storeState,
      },
    ),
  }
})

vi.mock('./chat-response-command', () => ({
  startChatResponse: mockedDeps.startChatResponse,
  cancelChatResponse: mockedDeps.cancelChatResponse,
}))

vi.mock('./sse-chat-transport', () => ({
  buildEventStreamFromResponse: mockedDeps.buildEventStreamFromResponse,
  onChatRunEvent: mockedDeps.onChatRunEvent,
}))

vi.mock('./chat-streaming-handler', () => ({
  ChatStreamingHandler: class {
    start() {}
    handleEvent() {}
    finish() {}
    fail() {}
  },
}))

describe('useChatSession session binding invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockedDeps.storeState.sessionMetaMap.clear()
    mockedDeps.storeState.messagesMap.clear()
    mockedDeps.storeState.subagentMessagesMap.clear()
    mockedDeps.storeState.generatingMessageIds.clear()
    mockedDeps.storeState.activeAbortControllers.clear()
    mockedDeps.startChatResponse.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    })
    mockedDeps.cancelChatResponse.mockResolvedValue(undefined)
    mockedDeps.storeState.setSessionMeta.mockImplementation((sessionId: string, meta: {
      cancelling?: boolean
      locallyDriving?: boolean
      passiveStatus?: string
      localDriverMessageId?: string
    }) => {
      const current = mockedDeps.storeState.sessionMetaMap.get(sessionId) ?? {}
      mockedDeps.storeState.sessionMetaMap.set(sessionId, { ...current, ...meta })
    })
    mockedDeps.buildEventStreamFromResponse.mockReturnValue({
      getReader: () => ({
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidates the generated session detail query when a local response starts and snapshot sync runs', async () => {
    const { result } = renderHook(() => useChatSession('session-1'))

    await act(async () => {
      await result.current.sendMessage('hello world')
    })

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const sessionBindingQueryKey = getSessionsByIdQueryKey({ path: { id: 'session-1' } })
    const sessionBindingInvalidations = mockedDeps.invalidateQueries.mock.calls
      .filter(([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: sessionBindingQueryKey }))

    expect(sessionBindingInvalidations.length).toBeGreaterThanOrEqual(2)
  })

  it('locally unlocks stop before requesting server-owned cancellation and refreshes after cancel settles', async () => {
    mockedDeps.storeState.messagesMap.set('session-1', [
      { id: 'assistant-1', role: 'assistant', parts: [] },
    ])
    mockedDeps.storeState.generatingMessageIds.add('assistant-1')
    mockedDeps.storeState.sessionMetaMap.set('session-1', {
      locallyDriving: true,
      localDriverMessageId: 'assistant-1',
      passiveStatus: 'streaming',
    })

    const { result } = renderHook(() => useChatSession('session-1'))

    await act(async () => {
      await result.current.stop()
    })

    expect(mockedDeps.storeState.stopGeneration).toHaveBeenCalledWith('assistant-1', 'session-1')
    expect(mockedDeps.storeState.setSessionMeta).toHaveBeenCalledWith('session-1', {
      cancelling: true,
      locallyDriving: false,
      localDriverMessageId: undefined,
      passiveStatus: 'idle',
    })
    expect(mockedDeps.cancelChatResponse).toHaveBeenCalledWith('session-1')
    expect(mockedDeps.storeState.sessionMetaMap.get('session-1')).toEqual(expect.objectContaining({
      cancelling: true,
      locallyDriving: false,
      passiveStatus: 'idle',
    }))

    await act(async () => {
      await vi.runAllTimersAsync()
    })

    const sessionBindingQueryKey = getSessionsByIdQueryKey({ path: { id: 'session-1' } })
    expect(mockedDeps.invalidateQueries).toHaveBeenCalledWith({ queryKey: sessionBindingQueryKey })
  })

  it('ignores stale streaming run events while local cancellation is pending', async () => {
    mockedDeps.storeState.sessionMetaMap.set('session-1', {
      cancelling: true,
      locallyDriving: false,
      localDriverMessageId: undefined,
      passiveStatus: 'idle',
    })

    renderHook(() => useChatSession('session-1'))

    const calls = mockedDeps.onChatRunEvent.mock.calls as unknown as Array<[string, ChatRunEventHandler]>
    const runEventHandler = calls.at(-1)?.[1]
    expect(runEventHandler).toBeDefined()

    act(() => {
      runEventHandler?.({
        chatSessionId: 'session-1',
        messageId: 'assistant-1',
        event: { type: 'run.streaming' },
      })
    })

    expect(mockedDeps.storeState.setPassiveStatus).not.toHaveBeenCalledWith('session-1', 'streaming')

    act(() => {
      runEventHandler?.({
        chatSessionId: 'session-1',
        messageId: 'assistant-1',
        event: { type: 'run.aborted' },
      })
    })

    expect(mockedDeps.storeState.setSessionMeta).toHaveBeenCalledWith('session-1', {
      cancelling: false,
      locallyDriving: false,
      localDriverMessageId: undefined,
    })
    expect(mockedDeps.storeState.setPassiveStatus).toHaveBeenCalledWith('session-1', 'idle')
  })
})
