import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../../plugins/mcp-registry'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../runtime-provider-types'
import { ClaudeAgentProvider } from './provider'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.query,
}))

function createAsyncQuery(
  items: unknown[],
  commands: Array<{ name: string, description: string, argumentHint: string, aliases?: string[] }> = [],
) {
  let index = 0
  let done = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (done || index >= items.length) {
        return { done: true as const, value: undefined }
      }
      const value = items[index]
      index += 1
      return { done: false as const, value }
    },
    async return() {
      done = true
      return { done: true as const, value: undefined }
    },
    close: vi.fn(),
    interrupt: vi.fn(),
    supportedCommands: vi.fn().mockResolvedValue(commands),
  }
}

function createPendingQuery() {
  let resolveNext: (() => void) | null = null
  let closed = false
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (closed) {
        return { done: true as const, value: undefined }
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve
      })
      return { done: true as const, value: undefined }
    },
    async return() {
      closed = true
      resolveNext?.()
      return { done: true as const, value: undefined }
    },
    close: vi.fn(() => {
      closed = true
      resolveNext?.()
    }),
    interrupt: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
  }
}

async function readPromptText(callIndex: number): Promise<string> {
  const call = sdkMocks.query.mock.calls[callIndex]?.[0] as { prompt?: AsyncIterable<{ message: { content: unknown } }> } | undefined
  const prompt = call?.prompt
  expect(prompt).toBeDefined()
  const result = await prompt![Symbol.asyncIterator]().next()
  expect(result.done).toBe(false)
  return String(result.value.message.content)
}

function createProfile(config: Record<string, unknown> = {}): RuntimeProviderTargetProfile {
  return {
    id: 'profile-claude',
    name: 'Claude Agent',
    providerKind: 'anthropic',
    enabled: true,
    configJson: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'bypassPermissions',
      ...config,
    }),
    credentialRef: 'credential-claude',
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-claude',
  }
}

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-claude',
    runtimeKind: 'claude-agent',
    providerSessionId: null,
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

describe('claudeAgentProvider MCP integration', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    sdkMocks.query.mockReset()
  })

  it('passes plugin-registered browser-use MCP server config to the Claude Agent SDK', async () => {
    addHostMcpServer({
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          content: [{ type: 'text', text: 'ready' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-1',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Open the browser'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'ready' }),
    ]))
    expect(sdkMocks.query).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.objectContaining({
        [Symbol.asyncIterator]: expect.any(Function),
      }),
      options: expect.objectContaining({
        mcpServers: expect.objectContaining({
          'browser-use': {
            command: 'node',
            args: ['/plugins/browser-use/dist/mcp-server.mjs'],
            env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
          },
        }),
      }),
    }))
    await expect(readPromptText(0)).resolves.toBe('Open the browser')
  })

  it('discovers SDK slash commands and forwards slash prompt text unchanged', async () => {
    const capabilitiesQuery = createAsyncQuery([], [
      { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
      { name: 'review', description: 'Review a target file', argumentHint: '<file>', aliases: ['code-review'] },
    ])
    const slashRunQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-2',
        message: {
          content: [{ type: 'text', text: 'reviewed' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-2',
        usage: { input_tokens: 2, output_tokens: 1 },
      },
    ])
    sdkMocks.query
      .mockReturnValueOnce(capabilitiesQuery)
      .mockReturnValueOnce(slashRunQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const profile = createProfile()

    await expect(provider.getCapabilities({
      runtimeSession,
      profile,
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual({
      runtimeKind: 'claude-agent',
      slashCommands: [
        { name: 'compact', description: 'Compact the conversation', argumentHint: '' },
        { name: 'review', description: 'Review a target file', argumentHint: '<file>', aliases: ['code-review'] },
      ],
      skills: [],
    })

    expect(capabilitiesQuery.supportedCommands).toHaveBeenCalledOnce()
    expect(capabilitiesQuery.close).toHaveBeenCalledOnce()
    const capabilitiesCall = sdkMocks.query.mock.calls[0]?.[0] as { prompt?: unknown } | undefined
    expect(typeof capabilitiesCall?.prompt).toBe('object')
    expect(typeof (capabilitiesCall?.prompt as AsyncIterable<unknown> | undefined)?.[Symbol.asyncIterator]).toBe('function')

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession,
      profile,
      message: createUserMessage('/review src/app.ts'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'reviewed' }),
    ]))
    expect(sdkMocks.query).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.objectContaining({
        [Symbol.asyncIterator]: expect.any(Function),
      }),
    }))
    await expect(readPromptText(1)).resolves.toBe('/review src/app.ts')
  })

  it('interrupts an active streaming-input query and appends steer text', async () => {
    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Initial task'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    await expect(readPromptText(0)).resolves.toBe('Initial task')
    await provider.steerTurn({
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Use React Query instead'),
    })

    expect(activeQuery.interrupt).toHaveBeenCalledOnce()
    await expect(readPromptText(0)).resolves.toBe('Use React Query instead')

    activeQuery.close()
    await pendingNext
  })

  it('passes configured Claude Agent SDK model aliases through the query environment', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-model-aliases',
        message: {
          content: [{ type: 'text', text: 'ready' }],
        },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const profile = createProfile({
      claudeAgent: {
        modelAliases: {
          haiku: ' claude-haiku-4-5 ',
          sonnet: 'claude-sonnet-4-5',
          opus: 'claude-opus-4-5',
        },
      },
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile,
      message: createUserMessage('Use aliases'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    expect(sdkMocks.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-4-5',
        }),
      }),
    }))
  })

  it('does not override Claude Agent SDK model defaults when aliases are empty', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-empty-aliases',
        message: {
          content: [{ type: 'text', text: 'ready' }],
        },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const profile = createProfile({
      claudeAgent: {
        modelAliases: {
          haiku: '',
          sonnet: '   ',
        },
      },
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile,
      message: createUserMessage('Use defaults'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    const call = sdkMocks.query.mock.calls[0]?.[0] as {
      options?: { env?: Record<string, string> }
    } | undefined
    expect(call?.options?.env).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL')
    expect(call?.options?.env).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL')
    expect(call?.options?.env).not.toHaveProperty('ANTHROPIC_DEFAULT_OPUS_MODEL')
  })

  it('emits separate text segments around tool calls inside one assistant message', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-segmented',
        message: {
          content: [
            { type: 'text', text: 'First text.' },
            { type: 'tool_use', id: 'tool-1', name: 'bash', input: { command: 'pwd' } },
            { type: 'text', text: 'Second text.' },
            { type: 'tool_use', id: 'tool-2', name: 'read_file', input: { path: 'README.md' } },
            { type: 'text', text: 'Final text.' },
          ],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-segmented',
        usage: { input_tokens: 4, output_tokens: 4 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Run segmented tools'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'First text.' },
      { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'bash' },
      { type: 'tool-input-available', toolCallId: 'tool-1', toolName: 'bash', input: { command: 'pwd' } },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Second text.' },
      { type: 'tool-input-start', toolCallId: 'tool-2', toolName: 'read_file' },
      { type: 'tool-input-available', toolCallId: 'tool-2', toolName: 'read_file', input: { path: 'README.md' } },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Final text.' },
      { type: 'text-end', id: expect.any(String) },
    ])
  })

  it('rejects file attachments because Claude Agent SDK prompts are text-only', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(async () => {
      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-test',
        runtimeSession: createRuntimeSession(),
        profile: createProfile(),
        message: {
          id: 'user-with-file',
          role: 'user',
          parts: [
            { type: 'text', text: 'Read this image' },
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'diagram.png',
              url: 'data:image/png;base64,test',
            },
          ],
        },
        workspaceId: 'workspace-1',
      })) {
        // Drain stream to force prompt projection.
      }
    }).rejects.toThrow('Claude Agent provider only supports text input; unsupported parts: file (diagram.png)')

    expect(sdkMocks.query).not.toHaveBeenCalled()
  })
})
