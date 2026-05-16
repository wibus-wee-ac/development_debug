// @vitest-environment jsdom
//
// Input: React hook test harness, mocked query client, and useChatSession lifecycle
// Output: Regression test that locks session binding invalidation onto the generated session detail query key
// Position: Chat feature regression test for token/contextWindow cache refresh after session model binding appears

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'

import { useChatSession } from './use-chat-session'

const mockedDeps = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  appendMessage: vi.fn(),
  setSessionMeta: vi.fn(),
  stopGeneration: vi.fn().mockResolvedValue(undefined),
  setMessages: vi.fn(),
  setPassiveStatus: vi.fn(),
  failGeneration: vi.fn(),
  setSubagentChunks: vi.fn(),
  startChatResponse: vi.fn(),
  onChatRunEvent: vi.fn(() => vi.fn()),
  buildChunkStreamFromResponse: vi.fn(),
}))

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
  const state = {
    sessionMetaMap: new Map<string, { locallyDriving?: boolean, passiveStatus?: string }>(),
    messagesMap: new Map<string, Array<unknown>>(),
    generatingMessageIds: new Set<string>(),
    appendMessage: mockedDeps.appendMessage,
    setSessionMeta: mockedDeps.setSessionMeta,
    stopGeneration: mockedDeps.stopGeneration,
    setMessages: mockedDeps.setMessages,
    setPassiveStatus: mockedDeps.setPassiveStatus,
    failGeneration: mockedDeps.failGeneration,
    setSubagentChunks: mockedDeps.setSubagentChunks,
  }

  return {
    chatSelectors: {
      messages: () => () => [],
      visibleStatus: () => () => 'idle',
      error: () => () => undefined,
    },
    useChatStore: Object.assign(
      (selector: (store: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
      },
    ),
  }
})

vi.mock('./chat-response-command', () => ({
  startChatResponse: mockedDeps.startChatResponse,
}))

vi.mock('./sse-chat-transport', () => ({
  buildChunkStreamFromResponse: mockedDeps.buildChunkStreamFromResponse,
  onChatRunEvent: mockedDeps.onChatRunEvent,
}))

vi.mock('./chat-streaming-handler', () => ({
  ChatStreamingHandler: class {
    start() {}
    handleChunk() {}
    finish() {}
    fail() {}
  },
}))

describe('useChatSession session binding invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockedDeps.startChatResponse.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(''),
    })
    mockedDeps.buildChunkStreamFromResponse.mockReturnValue({
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
})
