// Output: Regression coverage for the Codex app-server-backed runtime provider.
// Input: Fake app-server client requests, notifications, and Chat Runtime turn inputs.
// Position: Provider-owned tests for Codex streaming and live steer behavior.

import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './app-server-client'
import { CodexProvider } from './provider'

class FakeCodexAppServerClient {
  readonly requests: Array<{ method: string, params?: unknown }> = []
  options: CodexAppServerClientOptions
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

  async pushServerRequest(request: CodexAppServerServerRequest): Promise<unknown> {
    if (!this.options.serverRequestHandler) {
      throw new Error('Expected a Codex app-server server request handler')
    }
    const result = await this.options.serverRequestHandler(request)
    this.pushNotification({
      method: 'serverRequest/handled',
      params: {
        id: request.id,
        method: request.method,
        params: request.params,
        result,
      },
    })
    return result
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
  return createMessage([{ type: 'text', text }])
}

function createMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: `user-${parts.length}`,
    role: 'user',
    parts,
  }
}

function createProvider(client: FakeCodexAppServerClient): CodexProvider {
  return new CodexProvider({
    readSecret: () => 'sk-secret',
    resolveSkillPaths: () => ['/tmp/cradle-skill'],
    recordObservability: vi.fn(),
    createAppServerClient: (options) => {
      client.options = options
      return client
    },
  })
}

async function drainStream(stream: AsyncGenerator<UIMessageChunk, void, void>): Promise<void> {
  for await (const _chunk of stream) {
    // Drain stream.
  }
}

function codexInput(apiName: string, args: unknown) {
  return {
    type: 'cradle.builtin-tool-call.input.v1',
    identifier: 'codex',
    apiName,
    args,
  }
}

function codexOutput(apiName: string, args: unknown, result: unknown) {
  return {
    type: 'cradle.builtin-tool-call.result.v1',
    identifier: 'codex',
    apiName,
    args,
    result,
  }
}

describe('codexProvider app-server integration', () => {
  it('maps image attachments to Codex app-server user input', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createMessage([
        { type: 'text', text: 'Read these screenshots' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'screen.png',
          url: 'data:image/png;base64,test',
        },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          filename: 'local.jpg',
          url: 'file:///tmp/local.jpg',
        },
      ]),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    expect(client.requests[1]).toEqual({
      method: 'turn/start',
      params: expect.objectContaining({
        input: [
          { type: 'text', text: 'Read these screenshots', text_elements: [] },
          { type: 'image', url: 'data:image/png;base64,test' },
          { type: 'localImage', path: '/tmp/local.jpg' },
        ],
      }),
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Read',
      },
    })
    await firstChunkPromise
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    for await (const _chunk of stream) {
      // Drain stream.
    }
  })

  it('reconstructs Cradle transcript into Codex thread history before starting a fresh turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const history: UIMessage[] = [
      {
        id: 'history-user',
        role: 'user',
        parts: [
          { type: 'text', text: 'Earlier request' },
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'screen.png',
            url: 'data:image/png;base64,history',
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'spec.pdf',
            url: 'file:///tmp/spec.pdf',
          },
        ],
      },
      {
        id: 'history-assistant',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'I inspected the prior request.' },
          { type: 'text', text: 'Earlier answer' },
          {
            type: 'tool-command_execution',
            toolCallId: 'tool-1',
            state: 'output-available',
            input: { command: 'pwd' },
            output: { exitCode: 0, stdout: '/tmp/project\n' },
          } as UIMessage['parts'][number],
          {
            type: 'dynamic-tool',
            toolCallId: 'tool-2',
            toolName: 'custom_tool',
            state: 'output-error',
            input: { query: 'cradle' },
            errorText: 'failed',
          } as UIMessage['parts'][number],
        ],
      },
    ]
    const stream = provider.streamTurn({
      runId: 'run-codex-history-reconstruction',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Continue now'),
      transcript: {
        history,
        omittedMessageCount: 0,
        truncated: false,
        fallbackMessageCount: 0,
      },
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'thread/inject_items', 'turn/start'])
    })

    expect(client.requests[1]).toEqual({
      method: 'thread/inject_items',
      params: {
        threadId: 'codex-thread-1',
        items: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: 'Earlier request' },
              { type: 'input_image', image_url: 'data:image/png;base64,history' },
              {
                type: 'input_text',
                text: JSON.stringify({
                  type: 'cradle.file',
                  filename: 'spec.pdf',
                  mediaType: 'application/pdf',
                  url: 'file:///tmp/spec.pdf',
                }),
              },
            ],
          },
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'I inspected the prior request.' }],
            content: [{ type: 'reasoning_text', text: 'I inspected the prior request.' }],
            encrypted_content: null,
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Earlier answer' }],
          },
          {
            type: 'function_call',
            name: 'command_execution',
            arguments: JSON.stringify({ command: 'pwd' }),
            call_id: 'tool-1',
          },
          {
            type: 'function_call_output',
            call_id: 'tool-1',
            output: JSON.stringify({ exitCode: 0, stdout: '/tmp/project\n' }),
          },
          {
            type: 'function_call',
            name: 'custom_tool',
            arguments: JSON.stringify({ query: 'cradle' }),
            call_id: 'tool-2',
          },
          {
            type: 'function_call_output',
            call_id: 'tool-2',
            output: JSON.stringify({ error: 'failed' }),
          },
        ],
      },
    })
    expect(client.requests[2]).toEqual({
      method: 'turn/start',
      params: expect.objectContaining({
        input: [{ type: 'text', text: 'Continue now', text_elements: [] }],
      }),
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Continued',
      },
    })
    await firstChunkPromise
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })
    await drainStream(stream)
  })

  it('passes external OpenAI-compatible targets as explicit Codex model providers', async () => {
    const clients: FakeCodexAppServerClient[] = []
    const appServerOptions: CodexAppServerClientOptions[] = []
    const provider = new CodexProvider({
      readSecret: () => 'sk-secret',
      resolveSkillPaths: () => ['/tmp/cradle-skill'],
      recordObservability: vi.fn(),
      createAppServerClient: (options) => {
        appServerOptions.push(options)
        const client = new FakeCodexAppServerClient(options)
        clients.push(client)
        return client
      },
    })
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({
        baseUrl: 'https://example.test/v1',
        model: 'gpt-test',
      }),
      message: createUserMessage('Use external target'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(clients[0]?.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })
    const createdClient = clients[0]
    const options = appServerOptions[0]
    if (!createdClient || !options) {
      throw new Error('Expected Codex app-server client and options to be created')
    }

    expect(options.apiKey).toBe('sk-test')
    expect(options.config).toEqual(expect.objectContaining({
      approval_policy: 'never',
      sandbox_mode: 'danger-full-access',
      model: 'gpt-test',
      model_provider: 'cradle-openai-compatible',
      model_providers: {
        'cradle-openai-compatible': {
          name: 'Cradle OpenAI Compatible',
          base_url: 'https://example.test/v1',
          env_key: 'CRADLE_CODEX_API_KEY',
          wire_api: 'responses',
          requires_openai_auth: true,
        },
      },
    }))
    expect(createdClient.requests[0]).toEqual({
      method: 'thread/start',
      params: expect.objectContaining({
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      }),
    })
    expect(createdClient.requests[1]).toEqual({
      method: 'turn/start',
      params: expect.objectContaining({
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
      }),
    })

    createdClient.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Done',
      },
    })
    await firstChunkPromise
    createdClient.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    for await (const _chunk of stream) {
      // Drain stream.
    }
  })

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

  it('maps image attachments in live steer input', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Start'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    await provider.steerTurn({
      runtimeSession,
      profile: createProfile(),
      message: createMessage([
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'steer.png',
          url: 'data:image/png;base64,steer',
        },
      ]),
    })

    expect(client.requests.at(-1)).toEqual({
      method: 'turn/steer',
      params: {
        threadId: 'codex-thread-1',
        expectedTurnId: 'codex-turn-1',
        input: [{ type: 'image', url: 'data:image/png;base64,steer' }],
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
    await firstChunkPromise
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    for await (const _chunk of stream) {
      // Drain stream.
    }
  })

  it('rejects non-image file attachments before starting Codex app-server work', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)

    await expect(async () => {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-codex-test',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: createMessage([
          { type: 'text', text: 'Read this file' },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'brief.pdf',
            url: 'data:application/pdf;base64,test',
          },
        ]),
        workspaceId: 'workspace-1',
      })) {
        // Drain stream to force input projection.
      }
    }).rejects.toThrow('Codex provider only supports text and image input; unsupported parts: file (brief.pdf) (application/pdf)')

    expect(client.requests).toEqual([])
  })

  it('includes app-server error notification details in thrown diagnostics', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Use an incompatible endpoint'),
      workspaceId: 'workspace-1',
    })

    const drainPromise = drainStream(stream)

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'error',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        error: {
          message: 'Upstream model request failed',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        willRetry: false,
        code: 'invalid_request',
        details: {
          model: 'mimo-v2.5-pro',
          reason: 'endpoint does not support Codex app-server turn streaming',
        },
      },
    })

    await expect(drainPromise).rejects.toMatchObject({
      name: 'CodexProviderError',
      code: 'TURN_STREAM_FAILED',
      message: expect.stringContaining('event_types=error:1'),
      data: {
        diagnostics: {
          totalEvents: 1,
          mappedEvents: 0,
          eventTypeCounts: { error: 1 },
          errorEvents: [
            {
              method: 'error',
              params: expect.objectContaining({
                error: expect.objectContaining({
                  message: 'Upstream model request failed',
                }),
                willRetry: false,
                code: 'invalid_request',
              }),
            },
          ],
        },
        notification: {
          method: 'error',
          params: expect.objectContaining({
            error: expect.objectContaining({
              message: 'Upstream model request failed',
            }),
            willRetry: false,
            code: 'invalid_request',
          }),
        },
      },
    })
  })

  it('keeps streaming when Codex app-server reports a retryable transport error', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-retryable-error',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Keep going after reconnect'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'error',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        error: {
          message: 'Reconnecting... 1/5',
          codexErrorInfo: null,
          additionalDetails: 'stream disconnected before completion',
        },
        willRetry: true,
      },
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Recovered',
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: { type: 'text-start', id: 'assistant-message-1' },
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
      { type: 'text-delta', id: 'assistant-message-1', delta: 'Recovered' },
      { type: 'text-end', id: 'assistant-message-1' },
    ])
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
      { type: 'tool-input-available', toolCallId: 'tool-1', toolName: 'command_execution', input: codexInput('command_execution', { command: 'pwd' }) },
      { type: 'tool-output-available', toolCallId: 'tool-1', output: codexOutput('command_execution', { command: 'pwd' }, { command: 'pwd', output: '/tmp', exitCode: 0, code: 0 }) },
      { type: 'text-start', id: 'assistant-message-2' },
      { type: 'text-delta', id: 'assistant-message-2', delta: 'After tool' },
      { type: 'text-end', id: 'assistant-message-2' },
    ])
  })

  it('emits Codex plan items as structured tool output', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-plan',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Plan the task'),
      workspaceId: 'workspace-1',
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'plan-1', type: 'plan', text: '1. Inspect\n2. Patch' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'plan-1', type: 'plan', text: '1. Inspect\n2. Patch' },
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
      { type: 'tool-input-start', toolCallId: 'plan-1', toolName: 'plan' },
      { type: 'tool-input-available', toolCallId: 'plan-1', toolName: 'plan', input: codexInput('plan', { text: '1. Inspect\n2. Patch' }) },
      { type: 'tool-output-available', toolCallId: 'plan-1', output: codexOutput('plan', { text: '1. Inspect\n2. Patch' }, { plan: '1. Inspect\n2. Patch' }) },
    ])
  })

  it('emits Codex app-server tools as structured outputs', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-tools',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Use tools'),
      workspaceId: 'workspace-1',
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'file-1', type: 'fileChange', changes: [{ path: 'src/app.ts' }] },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'file-1', type: 'fileChange', changes: [{ path: 'src/app.ts' }], status: 'completed' },
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'mcp-1', type: 'mcpToolCall', server: 'github', tool: 'search', arguments: { query: 'cradle' } },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'mcp-1', type: 'mcpToolCall', server: 'github', tool: 'search', result: { content: [{ type: 'text', text: 'ok' }] } },
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'web-1', type: 'webSearch', query: 'Cradle', action: { type: 'search', query: 'Cradle' } },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'web-1', type: 'webSearch', query: 'Cradle', action: { type: 'search', query: 'Cradle' } },
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
      { type: 'tool-input-start', toolCallId: 'file-1', toolName: 'file_change' },
      { type: 'tool-input-available', toolCallId: 'file-1', toolName: 'file_change', input: codexInput('file_change', { filenames: ['src/app.ts'], status: 'started', type: 'fileChange' }) },
      { type: 'tool-output-available', toolCallId: 'file-1', output: codexOutput('file_change', { filenames: ['src/app.ts'], status: 'started', type: 'fileChange' }, { filenames: ['src/app.ts'], status: 'completed', type: 'fileChange' }) },
      { type: 'tool-input-start', toolCallId: 'mcp-1', toolName: 'github_search' },
      { type: 'tool-input-available', toolCallId: 'mcp-1', toolName: 'github_search', input: codexInput('github/search', { query: 'cradle' }) },
      { type: 'tool-output-available', toolCallId: 'mcp-1', output: codexOutput('github/search', { query: 'cradle' }, { server: 'github', tool: 'search', result: { content: [{ type: 'text', text: 'ok' }] }, content: [{ type: 'text', text: 'ok' }] }) },
      { type: 'tool-input-start', toolCallId: 'web-1', toolName: 'web_search' },
      { type: 'tool-input-available', toolCallId: 'web-1', toolName: 'web_search', input: codexInput('web_search', { query: 'Cradle', action: { type: 'search', query: 'Cradle' } }) },
      { type: 'tool-output-available', toolCallId: 'web-1', output: codexOutput('web_search', { query: 'Cradle', action: { type: 'search', query: 'Cradle' } }, { query: 'Cradle', action: { type: 'search', query: 'Cradle' } }) },
    ])
  })

  it('handles Codex app-server server requests as standardized tool chunks', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-server-request',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Run a command that needs approval'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    const params = { command: 'rm -rf build' }
    await expect(client.pushServerRequest({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params,
    })).resolves.toEqual({ decision: 'decline' })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: {
        type: 'tool-input-start',
        toolCallId: 'server-request-42',
        toolName: 'server_request_item_commandExecution_requestApproval',
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
      {
        type: 'tool-input-available',
        toolCallId: 'server-request-42',
        toolName: 'server_request_item_commandExecution_requestApproval',
        input: codexInput('approval.command_execution', params),
      },
      {
        type: 'tool-output-available',
        toolCallId: 'server-request-42',
        output: codexOutput('approval.command_execution', params, { decision: 'decline' }),
      },
    ])
  })
})
