import type { AgentProfile } from '@cradle/db'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeSession } from '../../runtime-provider-types'
import { addHostMcpServer, removeHostMcpServer } from '../../../../plugins/mcp-registry'
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
    supportedCommands: vi.fn().mockResolvedValue(commands),
  }
}

function createProfile(config: Record<string, unknown> = {}): AgentProfile {
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
    createdAt: 0,
    updatedAt: 0,
  }
}

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    agentProfileId: 'profile-claude',
    runtimeKind: 'claude-agent',
    providerSessionId: null,
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: null },
    }),
  }
}

describe('ClaudeAgentProvider MCP integration', () => {
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
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: 'Open the browser',
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'ready' }),
    ]))
    expect(sdkMocks.query).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Open the browser',
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
      runtimeSession,
      profile,
      message: '/review src/app.ts',
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'reviewed' }),
    ]))
    expect(sdkMocks.query).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: '/review src/app.ts',
    }))
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
      runtimeSession: createRuntimeSession(),
      profile,
      message: 'Use aliases',
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
      runtimeSession: createRuntimeSession(),
      profile,
      message: 'Use defaults',
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
})
