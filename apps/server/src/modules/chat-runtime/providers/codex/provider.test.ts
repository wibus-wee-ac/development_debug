// Output: Regression coverage for the Codex app-server-backed runtime provider.
// Input: Fake app-server client requests, notifications, and Chat Runtime turn inputs.
// Position: Provider-owned tests for Codex streaming and live steer behavior.

import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../runtime-provider-types'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server-client'
import { CodexProvider } from './provider'

class FakeCodexAppServerClient {
  readonly requests: Array<{ method: string, params?: unknown }> = []
  readonly options: CodexAppServerClientOptions
  close = vi.fn()
  initialize = vi.fn(async () => undefined)

  private readonly notifications: CodexAppServerMessage[] = []
  private notificationWaiter: ((message: CodexAppServerMessage | null) => void) | null = null

  constructor(options: CodexAppServerClientOptions) {
    this.options = options
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'thread/start') {
      return { thread: { id: 'codex-thread-1' } }
    }
    if (method === 'thread/resume') {
      return { thread: { id: (params as { threadId?: string }).threadId ?? 'codex-thread-1' } }
    }
    if (method === 'turn/start') {
      return { turn: { id: 'codex-turn-1', status: 'inProgress' } }
    }
    if (method === 'turn/steer') {
      return { turnId: 'codex-turn-1' }
    }
    return {}
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    const next = this.notifications.shift()
    if (next) {
      return next
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new Error('aborted'))
      signal?.addEventListener('abort', onAbort, { once: true })
      this.notificationWaiter = (message) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(message)
      }
    })
  }

  pushNotification(message: CodexAppServerMessage): void {
    if (this.notificationWaiter) {
      const waiter = this.notificationWaiter
      this.notificationWaiter = null
      waiter(message)
      return
    }
    this.notifications.push(message)
  }
}

function createProfile(config: Record<string, unknown> = {}): RuntimeProviderTargetProfile {
  return {
    id: 'profile-codex',
    name: 'Codex',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: JSON.stringify({
      apiKey: 'sk-test',
      model: 'gpt-5-codex',
      approvalPolicy: 'never',
      sandboxMode: 'workspace-write',
      reasoningEffort: 'high',
      ...config,
    }),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-codex',
  }
}

function createRuntimeSession(providerSessionId: string | null = null): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-codex',
    runtimeKind: 'codex',
    providerSessionId,
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: null },
    }),
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createProvider(client: FakeCodexAppServerClient): CodexProvider {
  return new CodexProvider({
    readSecret: () => 'sk-secret',
    resolveSkillPaths: () => ['/tmp/cradle-skill'],
    recordObservability: vi.fn(),
    createAppServerClient: () => client,
  })
}

describe('codexProvider app-server integration', () => {
  it('streams app-server notifications and applies live steer to the active turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Implement the feature'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    await provider.steerTurn({
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Use React Query instead'),
    })

    expect(client.requests.at(-1)).toEqual({
      method: 'turn/steer',
      params: {
        threadId: 'codex-thread-1',
        expectedTurnId: 'codex-turn-1',
        input: [{ type: 'text', text: 'Use React Query instead', text_elements: [] }],
      },
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Done',
      },
    })
    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'text-start' }),
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
      if (chunk.type === 'text-delta') {
        client.pushNotification({
          method: 'turn/completed',
          params: {
            threadId: 'codex-thread-1',
            turn: { id: 'codex-turn-1', status: 'completed' },
          },
        })
      }
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'Done' }),
      expect.objectContaining({ type: 'text-end' }),
    ]))
    expect(runtimeSession.providerSessionId).toBe('codex-thread-1')
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('resumes existing app-server threads before starting the turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession('existing-thread'),
      profile: createProfile(),
      message: createUserMessage('Continue'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests[0]).toEqual(expect.objectContaining({
        method: 'thread/resume',
        params: expect.objectContaining({ threadId: 'existing-thread', excludeTurns: true }),
      }))
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'existing-thread', turnId: 'codex-turn-1', itemId: 'assistant-message-1', delta: 'Continued' },
    })
    await firstChunkPromise
    client.pushNotification({
      method: 'turn/completed',
      params: { threadId: 'existing-thread', turn: { id: 'codex-turn-1', status: 'completed' } },
    })

    for await (const _chunk of stream) {
      // Drain stream.
    }

    expect(client.requests.map(request => request.method).slice(0, 2)).toEqual(['thread/resume', 'turn/start'])
  })

  it('keeps separate agent message items as separate text segments', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Segment messages'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'assistant-message-1', type: 'agentMessage', text: 'First text.' },
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: { type: 'text-start', id: 'assistant-message-1' },
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'assistant-message-2', type: 'agentMessage', text: 'Second text.' },
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', id: 'assistant-message-1', delta: 'First text.' },
      { type: 'text-end', id: 'assistant-message-1' },
      { type: 'text-start', id: 'assistant-message-2' },
      { type: 'text-delta', id: 'assistant-message-2', delta: 'Second text.' },
      { type: 'text-end', id: 'assistant-message-2' },
    ])
  })

  it('does not replay text when a completed snapshot follows text deltas for the same item', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Avoid replay'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Planning text.',
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: { type: 'text-start', id: 'assistant-message-1' },
    })

    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'assistant-message-1', type: 'agentMessage', text: 'Planning text.' },
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', id: 'assistant-message-1', delta: 'Planning text.' },
      { type: 'text-end', id: 'assistant-message-1' },
    ])
  })

  it('closes the current text segment before emitting tool chunks, then starts a new text segment after the tool', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Interleave tools'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Before tool',
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: { type: 'text-start', id: 'assistant-message-1' },
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'tool-1', type: 'commandExecution', command: 'pwd' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'tool-1', type: 'commandExecution', aggregatedOutput: '/tmp', exitCode: 0 },
      },
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-2',
        delta: 'After tool',
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-delta', id: 'assistant-message-1', delta: 'Before tool' },
      { type: 'text-end', id: 'assistant-message-1' },
      { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'command_execution' },
      { type: 'tool-input-available', toolCallId: 'tool-1', toolName: 'command_execution', input: { command: 'pwd' } },
      { type: 'tool-output-available', toolCallId: 'tool-1', output: '/tmp' },
      { type: 'text-start', id: 'assistant-message-2' },
      { type: 'text-delta', id: 'assistant-message-2', delta: 'After tool' },
      { type: 'text-end', id: 'assistant-message-2' },
    ])
  })
})
