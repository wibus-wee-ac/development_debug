// Input: TurnCoordinator async generator, mock providers
// Output: Unit tests verifying streaming lifecycle, cancellation, and error handling
// Position: Chat feature TurnCoordinator regression guard — runs without DB or Electron

import { describe, expect, it } from 'vitest'

import type { ChatRuntimeProvider, StreamTurnInput } from '../../agent-runtime/runtime-provider-types'
import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import type { TurnCoordinatorInput, TurnYield } from '../turn-coordinator'
import { coordinateTurn } from '../turn-coordinator'

function createMockProvider(events: TimelineInputEvent[]): ChatRuntimeProvider {
  return {
    providerKind: 'openai-compatible',
    checkHealth: async () => ({ ok: true, label: 'mock', version: '1', details: {}, errorText: null }),
    listModels: async () => [],
    startChatSession: async () => ({
      id: 'sess-1',
      chatSessionId: 'chat-1',
      agentProfileId: 'agent-1',
      providerKind: 'openai-compatible',
      providerSessionId: null,
      providerStateSnapshot: null,
    }),
    resumeChatSession: async () => ({
      id: 'sess-1',
      chatSessionId: 'chat-1',
      agentProfileId: 'agent-1',
      providerKind: 'openai-compatible',
      providerSessionId: null,
      providerStateSnapshot: null,
    }),
    async* streamTurn(_input: StreamTurnInput) {
      for (const event of events) {
        yield event
      }
    },
    cancelTurn: async () => {},
    lastUsage: null,
  }
}

function createErrorProvider(error: Error): ChatRuntimeProvider {
  return {
    ...createMockProvider([]),
    async* streamTurn() {
      throw error
    },
  }
}

function baseInput(provider: ChatRuntimeProvider, signal?: AbortSignal): TurnCoordinatorInput {
  return {
    provider,
    streamInput: {
      runtimeSession: {
        id: 'sess-1',
        chatSessionId: 'chat-1',
        agentProfileId: 'agent-1',
        providerKind: 'openai-compatible',
        providerSessionId: null,
        providerStateSnapshot: null,
      },
      profile: {
        id: 'agent-1',
        name: 'Test Agent',
        providerKind: 'openai-compatible',
        enabled: true,
        configJson: '{}',
        credentialRef: null,
        createdAt: 0,
        updatedAt: 0,
      },
      message: 'Hello',
    },
    providerKind: 'openai-compatible',
    signal: signal ?? new AbortController().signal,
  }
}

async function collectAll(
  gen: AsyncGenerator<TurnYield, unknown, undefined>,
): Promise<{ yields: TurnYield[], result: unknown }> {
  const yields: TurnYield[] = []
  let result: unknown
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
    yields.push(next.value)
  }
  return { yields, result }
}

describe('coordinateTurn', () => {
  it('yields run.started as first event and run.completed as last event on success', async () => {
    const providerEvents: TimelineInputEvent[] = [
      {
        type: 'assistant.message.started',
        itemId: 'item-1',
        source: { backend: 'openai-compatible', eventType: 'message.started' },
      },
      {
        type: 'assistant.text.delta',
        itemId: 'item-1',
        delta: 'Hello!',
        source: { backend: 'openai-compatible', eventType: 'text.delta' },
      },
      {
        type: 'assistant.message.completed',
        itemId: 'item-1',
        source: { backend: 'openai-compatible', eventType: 'message.completed' },
      },
    ]

    const provider = createMockProvider(providerEvents)
    const gen = coordinateTurn(baseInput(provider))
    const { yields, result } = await collectAll(gen)

    // First yield is run.started
    expect(yields[0].event.type).toBe('run.started')
    expect(yields[0].type).toBe('delta')

    // Middle yields are provider events
    expect(yields[1].event.type).toBe('assistant.message.started')
    expect(yields[2].event.type).toBe('assistant.text.delta')
    expect(yields[3].event.type).toBe('assistant.message.completed')

    // Last yield is run.completed (terminal)
    expect(yields[4].event.type).toBe('run.completed')
    expect(yields[4].type).toBe('terminal')

    // Result
    expect(result).toEqual({ status: 'complete', errorText: null })
  })

  it('yields run.failed with error text when provider throws', async () => {
    const error = new Error('Provider exploded')
    const provider = createErrorProvider(error)
    const gen = coordinateTurn(baseInput(provider))
    const { yields, result } = await collectAll(gen)

    // run.started + run.failed
    expect(yields).toHaveLength(2)
    expect(yields[0].event.type).toBe('run.started')
    expect(yields[1].event.type).toBe('run.failed')
    expect(yields[1].type).toBe('terminal')

    if (yields[1].event.type === 'run.failed') {
      expect(yields[1].event.error).toBe('Provider exploded')
    }

    expect(result).toEqual({ status: 'failed', errorText: 'Provider exploded' })
  })

  it('yields run.aborted when signal is aborted before stream completes', async () => {
    const controller = new AbortController()
    let yieldCount = 0

    // Provider yields events one at a time; after 2nd yield, we abort
    const provider: ChatRuntimeProvider = {
      ...createMockProvider([]),
      async* streamTurn() {
        yield {
          type: 'assistant.message.started' as const,
          itemId: 'item-1',
          source: { backend: 'openai-compatible' as const, eventType: 'message.started' },
        }
        // After yielding, this will be picked up and then we abort
        yield {
          type: 'assistant.text.delta' as const,
          itemId: 'item-1',
          delta: 'Hi',
          source: { backend: 'openai-compatible' as const, eventType: 'text.delta' },
        }
        // This third yield should not be reached because we abort after collecting delta
        yield {
          type: 'assistant.message.completed' as const,
          itemId: 'item-1',
          source: { backend: 'openai-compatible' as const, eventType: 'message.completed' },
        }
      },
    }

    const gen = coordinateTurn(baseInput(provider, controller.signal))
    const yields: TurnYield[] = []

    for await (const item of { [Symbol.asyncIterator]: () => gen }) {
      yields.push(item)
      yieldCount++
      // Abort after receiving run.started + message.started + text.delta (3 events)
      if (yieldCount === 3) {
        controller.abort()
      }
    }

    // run.started, message.started, text.delta, run.aborted
    expect(yields[0].event.type).toBe('run.started')
    expect(yields[1].event.type).toBe('assistant.message.started')
    expect(yields[2].event.type).toBe('assistant.text.delta')
    // Once aborted, the loop breaks and we get the terminal event
    const lastYield = yields.at(-1)!
    expect(lastYield.event.type).toBe('run.aborted')
    expect(lastYield.type).toBe('terminal')
  })

  it('includes error code in error text when available', async () => {
    const error = Object.assign(new Error('rate limited'), { code: 429 })
    const provider = createErrorProvider(error)
    const gen = coordinateTurn(baseInput(provider))
    const { result } = await collectAll(gen)

    expect(result).toEqual({ status: 'failed', errorText: '[code 429] rate limited' })
  })

  it('handles non-Error thrown values', async () => {
    const provider: ChatRuntimeProvider = {
      ...createMockProvider([]),
      async* streamTurn() {
        // eslint-disable-next-line no-throw-literal
        throw 'string error'
      },
    }

    const gen = coordinateTurn(baseInput(provider))
    const { result } = await collectAll(gen)

    expect(result).toEqual({ status: 'failed', errorText: 'string error' })
  })

  it('provider events are passed through unmodified', async () => {
    const toolEvent: TimelineInputEvent = {
      type: 'command.started',
      itemId: 'cmd-1',
      command: 'ls',
      input: '-la',
      source: { backend: 'openai-compatible', eventType: 'command.started' },
    }

    const provider = createMockProvider([toolEvent])
    const gen = coordinateTurn(baseInput(provider))
    const { yields } = await collectAll(gen)

    // run.started, command.started, run.completed
    expect(yields[1].event).toEqual(toolEvent)
    expect(yields[1].type).toBe('delta')
  })
})
