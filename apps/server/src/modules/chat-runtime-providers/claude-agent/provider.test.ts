import { existsSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CanUseTool, SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../plugins/mcp-registry'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { ClaudeAgentProvider } from './provider'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  renameSession: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdkMocks.query,
  getSessionInfo: sdkMocks.getSessionInfo,
  renameSession: sdkMocks.renameSession,
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
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue(commands),
    getContextUsage: vi.fn().mockResolvedValue(createContextUsageResponse()),
  }
}

function createPendingQuery(contextUsage: SDKControlGetContextUsageResponse = createContextUsageResponse()) {
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
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    getContextUsage: vi.fn().mockResolvedValue(contextUsage),
  }
}

function createContextUsageResponse(
  overrides: Partial<SDKControlGetContextUsageResponse> = {},
): SDKControlGetContextUsageResponse {
  return {
    categories: [
      { name: 'System prompt', tokens: 100, color: '#2563eb' },
      { name: 'Messages', tokens: 250, color: '#16a34a' },
      { name: 'Unclassified provider payload', tokens: 17, color: '#71717a' },
    ],
    totalTokens: 367,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0.1835,
    gridRows: [],
    model: 'claude-sonnet-4-20250514',
    memoryFiles: [
      { path: '/tmp/CLAUDE.md', type: 'project', tokens: 42 },
    ],
    mcpTools: [
      { name: 'search', serverName: 'browser', tokens: 11, isLoaded: true },
    ],
    agents: [],
    isAutoCompactEnabled: true,
    messageBreakdown: {
      toolCallTokens: 7,
      toolResultTokens: 13,
      attachmentTokens: 0,
      assistantMessageTokens: 150,
      userMessageTokens: 100,
      redirectedContextTokens: 0,
      unattributedTokens: 5,
      toolCallsByType: [
        { name: 'Read', callTokens: 3, resultTokens: 4 },
      ],
      attachmentsByType: [],
    },
    apiUsage: {
      input_tokens: 367,
      output_tokens: 21,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  }
}

function readQueryOptions(callIndex: number): Record<string, unknown> {
  const call = sdkMocks.query.mock.calls[callIndex]?.[0] as { options?: Record<string, unknown> } | undefined
  expect(call?.options).toBeDefined()
  return call!.options!
}

async function readPromptText(callIndex: number): Promise<string> {
  const content = await readPromptContent(callIndex)
  return String(content)
}

async function readPromptContent(callIndex: number): Promise<unknown> {
  const call = sdkMocks.query.mock.calls[callIndex]?.[0] as { prompt?: AsyncIterable<{ message: { content: unknown } }> } | undefined
  const prompt = call?.prompt
  expect(prompt).toBeDefined()
  const result = await prompt![Symbol.asyncIterator]().next()
  expect(result.done).toBe(false)
  return result.value.message.content
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

function createResumedRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    ...createRuntimeSession(),
    providerSessionId: 'claude-session-1',
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: 'claude-sonnet-4-20250514' },
    }),
    ...overrides,
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function createBangCommandMessage(command: string): UIMessage {
  return {
    id: `bang-command-${command}`,
    role: 'user',
    parts: [{ type: 'text', text: `!${command}` }],
    metadata: {
      cradle: {
        bangCommand: { command },
      },
    },
  } as UIMessage
}

function createBangResultMessage(input: {
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  durationMs?: number
}): UIMessage {
  const text = input.stdout ?? input.stderr ?? ''
  return {
    id: `bang-result-${input.command}`,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: {
      cradle: {
        bangResult: {
          command: input.command,
          stdout: input.stdout ?? '',
          stderr: input.stderr ?? '',
          exitCode: input.exitCode ?? 0,
          durationMs: input.durationMs ?? 1,
          timedOut: false,
          truncated: false,
        },
      },
    },
  } as UIMessage
}

describe('claudeAgentProvider MCP integration', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
    sdkMocks.query.mockReset()
    sdkMocks.getSessionInfo.mockReset()
    sdkMocks.renameSession.mockReset()
  })

  it('passes plugin-registered browser-use MCP server config to the Claude Agent SDK', async () => {
    addHostMcpServer({
      transport: 'stdio',
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
            type: 'stdio',
            command: 'node',
            args: ['/plugins/browser-use/dist/mcp-server.mjs'],
            env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
          },
        }),
      }),
    }))
    await expect(readPromptText(0)).resolves.toBe('Open the browser')
  })

  it('passes plugin-registered streamable HTTP MCP server config to the Claude Agent SDK', async () => {
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer nowledge-secret' },
    })
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-http-mcp',
        message: {
          content: [{ type: 'text', text: 'ready' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-http-mcp',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-http-mcp-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Read Nowledge memory'),
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'ready' }),
    ]))
    expect(sdkMocks.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        mcpServers: expect.objectContaining({
          'nowledge-mem': {
            type: 'http',
            url: 'https://nowledge.example.test/mcp',
            headers: { Authorization: 'Bearer nowledge-secret' },
          },
        }),
      }),
    }))
  })

  it('defaults Claude Agent runs to bypass permissions and persists under Cradle runtime data', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-default-permissions',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-default-permissions',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ permissionMode: undefined }),
      message: createUserMessage('Use the default mode'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: true,
      env: expect.objectContaining({
        CLAUDE_CONFIG_DIR: join(process.env.CRADLE_DATA_DIR!, 'runtimes', 'claude-agent'),
      }),
    }))
  })

  it('keeps ExitPlanMode available and captures it through the permission hook', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-plan-permission',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-permission',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Plan the work'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
      },
    })) {
      // Drain stream.
    }

    const options = readQueryOptions(0)
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['AskUserQuestion', 'EnterPlanMode']))
    expect(options.disallowedTools).not.toContain('ExitPlanMode')
    await expect((options.canUseTool as CanUseTool)(
      'ExitPlanMode',
      { plan: '1. Inspect\n2. Patch' },
      {
        signal: new AbortController().signal,
        toolUseID: 'toolu_plan_1',
      },
    )).resolves.toEqual({
      behavior: 'deny',
      message: 'Cradle captured the proposed plan. Stop here and wait for the user to refine or implement it in a later turn.',
    })
  })

  it('projects captured ExitPlanMode plans into composer UI slot state', async () => {
    const plan = '1. Inspect\n2. Patch\n3. Verify'
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-plan-slot',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_plan_1',
              name: 'ExitPlanMode',
              input: { plan },
            },
          ],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-plan-slot',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-plan-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Plan the work'),
      workspaceId: 'workspace-1',
      providerOptions: {
        runtimeSettings: { accessMode: 'approval-required', interactionMode: 'plan' },
      },
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      { type: 'tool-approval-request', toolCallId: 'implement-plan:toolu_plan_1', approvalId: 'implement-plan:toolu_plan_1' },
    ]))
    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.plan).toEqual(expect.objectContaining({
      threadId: 'chat-session-1',
      turnId: 'toolu_plan_1',
      content: plan,
      steps: [
        { step: '1. Inspect', status: 'pending' },
        { step: '2. Patch', status: 'pending' },
        { step: '3. Verify', status: 'pending' },
      ],
      updatedAt: expect.any(Number),
    }))

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'plan',
        slotId: 'claude-agent:plan',
        threadId: 'chat-session-1',
        turnId: 'toolu_plan_1',
        content: plan,
        currentStep: '1. Inspect',
        pendingCount: 3,
        inProgressCount: 0,
        completedCount: 0,
      }),
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
      }),
    ])
  })

  it('projects captured TodoWrite state into progress UI slot state', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-progress-slot',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_todo_1',
              name: 'TodoWrite',
              input: {
                todos: [
                  { id: 'todo-1', content: 'Inspect', status: 'pending' },
                  { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
                  { id: 'todo-3', content: 'Verify', status: 'completed' },
                ],
              },
            },
          ],
        },
      },
      {
        type: 'user',
        session_id: 'claude-session-progress-slot',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_todo_1',
              content: { ok: true },
            },
          ],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-progress-slot',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createRuntimeSession()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-progress-slot',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Work through todos'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent.progress).toEqual(expect.objectContaining({
      threadId: 'chat-session-1',
      turnId: 'toolu_todo_1',
      source: 'TodoWrite',
      items: [
        { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
        { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
        { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
      ],
      updatedAt: expect.any(Number),
    }))

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'progress',
        slotId: 'claude-agent:progress',
        threadId: 'chat-session-1',
        turnId: 'toolu_todo_1',
        source: 'TodoWrite',
        currentItem: 'Patching',
        pendingCount: 1,
        inProgressCount: 1,
        completedCount: 1,
        items: [
          { id: 'todo-1', label: 'Inspect', status: 'pending', sourceStatus: 'pending' },
          { id: 'todo-2', label: 'Patching', status: 'inProgress', sourceStatus: 'in_progress' },
          { id: 'todo-3', label: 'Verify', status: 'completed', sourceStatus: 'completed' },
        ],
      }),
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
      }),
    ])
  })

  it('runs agent-scoped Claude Agent sessions from the agent home while keeping workspace context explicit', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'cradle-claude-agent-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = homeDir
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-agent-home',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    try {
      const provider = new ClaudeAgentProvider({
        readSecret: () => 'sk-ant-test',
      })
      const runtimeSession = createRuntimeSession()
      runtimeSession.providerStateSnapshot = JSON.stringify({
        workspacePath: '/tmp/cradle-workspace',
        agentId: 'agent-007',
        models: { currentModelId: null },
      })

      for await (const _chunk of provider.streamTurn({
        runId: 'run-claude-agent-home',
        runtimeSession,
        profile: createProfile({ additionalDirectories: ['/tmp/extra-directory'] }),
        message: createUserMessage('Use agent home'),
        workspaceId: 'workspace-1',
        agentId: 'agent-007',
      })) {
        // Drain stream.
      }

      const agentHome = join(homeDir, '.cradle', 'agents', 'agent-007')
      expect(readQueryOptions(0)).toEqual(expect.objectContaining({
        cwd: agentHome,
        additionalDirectories: ['/tmp/cradle-workspace', '/tmp/extra-directory'],
        env: expect.objectContaining({
          CRADLE_CHAT_SESSION_ID: 'chat-session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
          CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
          CRADLE_AGENT_ID: 'agent-007',
          CRADLE_AGENT_HOME: agentHome,
        }),
      }))
      expect(existsSync(join(agentHome, 'skills'))).toBe(true)
      expect(readlinkSync(join(agentHome, '.agents', 'skills'))).toBe('../skills')
      expect(readlinkSync(join(agentHome, '.claude', 'skills'))).toBe('../skills')
    }
    finally {
      rmSync(homeDir, { recursive: true, force: true })
      if (previousHome === undefined) {
        delete process.env.HOME
      }
      else {
        process.env.HOME = previousHome
      }
    }
  })

  it('does not ask the Claude Agent SDK to globally discover skills unless configured', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-no-skills',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-no-skills',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Do not scan skills by default'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).not.toHaveProperty('skills')
  })

  it('forwards explicitly configured Claude Agent skills', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-configured-skills',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-configured-skills',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ skills: ['review'] }),
      message: createUserMessage('Use configured skills'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      skills: ['review'],
    }))
  })

  it('normalizes removed Claude Agent permission modes to bypass permissions', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-legacy-permissions',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-legacy-permissions',
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ permissionMode: 'acceptEdits' }),
      message: createUserMessage('Use a legacy mode'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
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

    await expect(provider.getPresentation({
      runtimeSession,
      profile,
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual({
      runtimeKind: 'claude-agent',
      slashCommands: [
        { name: 'compact', description: 'Compact the conversation', argumentHint: '', aliases: undefined },
        { name: 'review', description: 'Review a target file', argumentHint: '<file>', aliases: ['code-review'] },
      ],
      uiSlots: [
        {
          id: 'claude-agent:compact',
          name: 'compact',
          label: 'Compact',
          description: 'Compact this conversation context.',
          argumentHint: '',
          aliases: ['summarize'],
          iconKey: 'compact',
          commandText: '/compact ',
          surfaces: ['runtimePanel'],
        },
        {
          id: 'claude-agent:quick-question',
          name: 'btw',
          label: 'Quick question',
          description: 'Ask a quick question without saving it to history.',
          argumentHint: '[question]',
          aliases: ['quick-question'],
          iconKey: 'quick-question',
          commandText: '/btw ',
          surfaces: ['slashCommand', 'composerState'],
        },
        {
          id: 'claude-agent:plan',
          name: 'plan',
          label: 'Plan',
          description: 'Show the current execution plan.',
          argumentHint: '',
          iconKey: 'plan',
          commandText: '/plan ',
          surfaces: ['composerState', 'runtimePanel'],
        },
        {
          id: 'claude-agent:progress',
          name: 'progress',
          label: 'Progress',
          description: 'Show the current task progress.',
          argumentHint: '',
          iconKey: 'progress',
          surfaces: ['composerState', 'runtimePanel'],
        },
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

  it('streams quick questions without persisting SDK sessions or loading tools', async () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
    })
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-quick-question-session',
        message: {
          content: [{ type: 'text', text: 'Use the exported helper.' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-quick-question-session',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.quickQuestion({
      runtimeSession: createRuntimeSession(),
      profile: createProfile({ skills: ['review'], tools: ['Read'] }),
      question: 'Which helper should I use?',
      transcript: [
        createUserMessage('How should this module expose helpers?'),
        {
          id: 'assistant-context',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The module exports named helpers.' }],
        },
      ],
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'Use the exported helper.' }),
    ]))
    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      persistSession: false,
      tools: [],
      model: 'claude-sonnet-4-20250514',
    }))
    expect(readQueryOptions(0)).not.toHaveProperty('mcpServers')
    expect(readQueryOptions(0)).not.toHaveProperty('skills')
    const promptText = await readPromptText(0)
    expect(promptText).toContain('Previous messages in this Cradle chat session:')
    expect(promptText).toContain('User: How should this module expose helpers?')
    expect(promptText).toContain('Assistant: The module exports named helpers.')
    expect(promptText).toContain('Current user message:\nWhich helper should I use?')
  })

  it('resumes a stored Claude Agent SDK session and applies a pending model switch', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-2',
        message: {
          content: [{ type: 'text', text: 'Context preserved' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-2',
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      modelId: 'claude-opus-4-20250514',
    })
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-model-switch',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Continue with the same context'),
      modelId: 'claude-opus-4-20250514',
      workspaceId: 'workspace-1',
    })

    const firstChunk = stream.next()
    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })
    expect(activeQuery.setModel).toHaveBeenCalledWith('claude-opus-4-20250514')

    const call = sdkMocks.query.mock.calls[0]?.[0] as {
      options?: { model?: string, resume?: string }
      prompt?: AsyncIterable<{ message: { content: unknown } }>
    } | undefined
    expect(call?.options).toEqual(expect.objectContaining({
      model: 'claude-opus-4-20250514',
      persistSession: true,
      resume: 'claude-session-1',
    }))

    await expect(call!.prompt![Symbol.asyncIterator]().next()).resolves.toEqual(expect.objectContaining({
      done: false,
      value: expect.objectContaining({
        message: { role: 'user', content: 'Continue with the same context' },
      }),
    }))
    await expect(firstChunk).resolves.toEqual(expect.objectContaining({
      done: false,
      value: expect.objectContaining({ type: 'text-start' }),
    }))

    const remainingChunks: UIMessageChunk[] = []
    for await (const chunk of stream) {
      remainingChunks.push(chunk)
    }

    expect(remainingChunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'Context preserved' }),
    ]))
    expect(runtimeSession.providerSessionId).toBe('claude-session-2')
    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent?.pendingModelSwitchId).toBeUndefined()
  })

  it('does not call setModel when a resumed turn repeats the snapshot model override', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          content: [{ type: 'text', text: 'Same model continued' }],
        },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      modelId: 'claude-sonnet-4-20250514',
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-same-model',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Continue on the same model'),
      modelId: 'claude-sonnet-4-20250514',
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(activeQuery.setModel).not.toHaveBeenCalled()
    expect(readQueryOptions(0)).toEqual(expect.objectContaining({
      persistSession: true,
      resume: 'claude-session-1',
    }))
    expect(JSON.parse(runtimeSession.providerStateSnapshot!).claudeAgent?.pendingModelSwitchId).toBeUndefined()
  })

  it('projects Claude session titles from SDK session metadata into the Cradle session title callback', async () => {
    sdkMocks.getSessionInfo.mockResolvedValue({
      sessionId: 'claude-session-title',
      summary: 'Claude SDK summary',
      customTitle: '  Claude custom title  ',
      lastModified: 1,
    })
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-title',
        message: {
          content: [{ type: 'text', text: 'ready' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-title',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const reportSessionTitle = vi.fn()
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-title-projection',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Continue the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })) {
      // Drain stream.
    }

    expect(reportSessionTitle).toHaveBeenCalledWith('Claude custom title')
    expect(sdkMocks.getSessionInfo).toHaveBeenCalledWith('claude-session-title', {
      dir: '/tmp/cradle-workspace',
    })
  })

  it('uses the runtime session model snapshot when a resumed Claude Agent turn has no explicit model override', async () => {
    const activeQuery = createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-snapshot-model',
        message: {
          content: [{ type: 'text', text: 'Snapshot model used' }],
        },
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession({
      providerStateSnapshot: JSON.stringify({
        workspacePath: '/tmp/cradle-workspace',
        models: { currentModelId: 'mimo-v2.5-pro' },
      }),
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-snapshot-model',
      runtimeSession,
      profile: createProfile({ model: 'claude-sonnet-4-20250514' }),
      message: createUserMessage('Continue without a per-turn model override'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    const call = sdkMocks.query.mock.calls[0]?.[0] as {
      options?: { model?: string, env?: Record<string, string | undefined> }
    } | undefined
    expect(activeQuery.setModel).not.toHaveBeenCalled()
    expect(call?.options?.model).toBe('mimo-v2.5-pro')
    expect(call?.options?.env?.ANTHROPIC_MODEL).toBeUndefined()
  })

  it('includes Cradle chat history when a provider-target switch starts a new Claude Agent SDK session', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-new-target',
        message: {
          content: [{ type: 'text', text: 'You said hello earlier.' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-new-target',
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-claude-agent-target-switch',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('What did I say earlier?'),
      history: [
        createUserMessage('Hello earlier'),
        {
          id: 'assistant-earlier',
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Internal chain should not be replayed' },
            { type: 'text', text: 'Hi, I remember that.' },
          ],
        },
      ],
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'You said hello earlier.' }),
    ]))
    await expect(readPromptText(0)).resolves.toBe([
      'Previous messages in this Cradle chat session:',
      'User: Hello earlier',
      '',
      'Assistant: Hi, I remember that.',
      '',
      'Current user message:',
      'What did I say earlier?',
    ].join('\n'))
  })

  it('replays recent Cradle local history when resuming a stored Claude Agent SDK session', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          content: [{ type: 'text', text: 'The command counted the workspace.' }],
        },
      },
      {
        type: 'result',
        session_id: 'claude-session-1',
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    ]))

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-resumed-bang-history',
      runtimeSession: createResumedRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Can you see the local command output?'),
      history: [
        createUserMessage('Normal previous chat already lives in the SDK session'),
        {
          id: 'assistant-earlier',
          role: 'assistant',
          parts: [{ type: 'text', text: 'The SDK transcript has this message.' }],
        },
        createBangCommandMessage('scc'),
        createBangResultMessage({
          command: 'scc',
          stdout: 'TypeScript 1911 files\nTotal 3978 files\n',
          exitCode: 0,
          durationMs: 171,
        }),
      ],
      workspaceId: 'workspace-1',
    })) {
      // Drain stream to force query construction.
    }

    await expect(readPromptText(0)).resolves.toBe([
      'Previous messages in this Cradle chat session:',
      'User ran local shell command: $ scc',
      '',
      'Local shell command result for `$ scc` (exit code 0, 171ms):',
      'TypeScript 1911 files',
      'Total 3978 files',
      '',
      'Current user message:',
      'Can you see the local command output?',
    ].join('\n'))
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

  it('uses the effective model fallback when Claude Agent model aliases are empty', async () => {
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
    expect(call?.options?.env).toMatchObject({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-sonnet-4-20250514',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-20250514',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-sonnet-4-20250514',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-sonnet-4-20250514',
    })
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
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: expect.objectContaining({
          identifier: 'claude-code',
          apiName: 'Bash',
          args: { command: 'pwd' },
        }),
      },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Second text.' },
      { type: 'tool-input-start', toolCallId: 'tool-2', toolName: 'read_file' },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-2',
        toolName: 'read_file',
        input: expect.objectContaining({
          identifier: 'claude-code',
          apiName: 'Read',
          args: { path: 'README.md' },
        }),
      },
      { type: 'text-start', id: expect.any(String) },
      { type: 'text-delta', id: expect.any(String), delta: 'Final text.' },
      { type: 'text-end', id: expect.any(String) },
      { type: 'finish', finishReason: 'stop' },
    ])
  })

  it('projects image file attachments into Claude Agent SDK image content blocks', async () => {
    sdkMocks.query.mockReturnValue(createAsyncQuery([
      {
        type: 'assistant',
        session_id: 'claude-session-image-input',
        message: {
          content: [{ type: 'text', text: 'I can see it.' }],
        },
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
      message: {
        id: 'user-with-image',
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
      chunks.push(chunk)
    }

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'I can see it.' }),
    ]))
    await expect(readPromptContent(0)).resolves.toEqual([
      { type: 'text', text: 'Read this image' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'test',
        },
      },
    ])
  })

  it('interrupts an active query and appends steered image content blocks', async () => {
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
      message: {
        id: 'steer-with-image',
        role: 'user',
        parts: [
          { type: 'text', text: 'Use this screenshot instead' },
          {
            type: 'file',
            mediaType: 'image/jpeg',
            filename: 'screen.jpg',
            url: 'data:image/jpeg;base64,screen-data',
          },
        ],
      },
    })

    expect(activeQuery.interrupt).toHaveBeenCalledOnce()
    await expect(readPromptContent(0)).resolves.toEqual([
      { type: 'text', text: 'Use this screenshot instead' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: 'screen-data',
        },
      },
    ])

    activeQuery.close()
    await pendingNext
  })

  it('rejects non-image file attachments at the provider boundary', async () => {
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
              mediaType: 'application/pdf',
              filename: 'brief.pdf',
              url: 'data:application/pdf;base64,test',
            },
          ],
        },
        workspaceId: 'workspace-1',
      })) {
        // Drain stream to force prompt projection.
      }
    }).rejects.toThrow('Claude Agent provider only supports text, image, skill, and plugin mention input; unsupported parts: file (brief.pdf) (application/pdf)')

    expect(sdkMocks.query).not.toHaveBeenCalled()
  })

  it('reads active Claude Agent SDK context usage with open category fallback', async () => {
    const activeQuery = createPendingQuery(createContextUsageResponse())
    sdkMocks.query.mockReturnValue(activeQuery)

    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })
    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-context',
    })
    const stream = provider.streamTurn({
      runId: 'run-claude-agent-context-usage',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect context usage'),
      workspaceId: 'workspace-1',
    })
    const pendingNext = stream.next()

    await vi.waitFor(() => {
      expect(sdkMocks.query).toHaveBeenCalledOnce()
    })

    const usage = await provider.getContextUsage({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    expect(usage).toEqual(expect.objectContaining({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-context',
      source: 'claude-agent-sdk.getContextUsage',
      model: 'claude-sonnet-4-20250514',
      totalTokens: 367,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      percentage: 0.1835,
    }))

    const slotStates = await provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    expect(slotStates).toEqual([
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
        threadId: 'chat-session-1',
        total: expect.objectContaining({
          totalTokens: 367,
          inputTokens: 367,
        }),
        modelContextWindow: 200_000,
        usagePercent: 0.1835,
      }),
    ])

    const sections = new Map(usage!.sections.map(section => [section.kind, section]))
    expect(sections.get('system-prompt')).toEqual(expect.objectContaining({
      label: 'System prompt',
      tokenCount: 100,
      color: '#2563eb',
    }))
    expect(sections.get('messages')).toEqual(expect.objectContaining({
      label: 'Messages',
      tokenCount: 250,
    }))
    expect(sections.get('messages')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant-message-tokens', tokenCount: 150 }),
      expect.objectContaining({ kind: 'user-message-tokens', tokenCount: 100 }),
    ]))
    expect(sections.get('others')).toEqual(expect.objectContaining({
      label: 'Unclassified provider payload',
      tokenCount: 17,
    }))
    expect(sections.get('memory-files')).toEqual(expect.objectContaining({
      tokenCount: 42,
    }))
    expect(sections.get('memory-files')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'memory-file', label: '/tmp/CLAUDE.md', tokenCount: 42 }),
    ]))
    expect(sections.get('tools')).toEqual(expect.objectContaining({
      tokenCount: 7,
    }))
    expect(sections.get('tools')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool-call-tokens', tokenCount: 7 }),
      expect.objectContaining({ kind: 'tool-call-type', label: 'Read', tokenCount: 7 }),
    ]))

    activeQuery.close()
    await pendingNext
  })

  it('reuses cached compact slot state when Claude Agent context usage refresh fails', async () => {
    vi.useFakeTimers()
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createPendingQuery()
    sdkMocks.query.mockReturnValue(activeQuery)

    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-context-cache',
    })
    try {
      const pendingStream = (async () => {
        for await (const _chunk of provider.streamTurn({
          runId: 'run-claude-agent-context-cache',
          runtimeSession,
          profile: createProfile(),
          message: createUserMessage('Keep running'),
          workspaceId: 'workspace-1',
        })) {
          // Keep stream active until the query closes.
        }
      })()

      await provider.getContextUsage({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      })
      await provider.getUiSlotStates({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      })

      vi.setSystemTime(Date.now() + 20_000)
      activeQuery.getContextUsage.mockRejectedValueOnce(new Error('Query closed before response received'))

      await expect(provider.getUiSlotStates({
        runtimeSession,
        profile: createProfile(),
        workspacePath: '/tmp/cradle-workspace',
      })).resolves.toEqual([
        expect.objectContaining({
          kind: 'compact',
          slotId: 'claude-agent:compact',
        }),
      ])

      activeQuery.close()
      await pendingStream
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('returns null context usage when no Claude Agent query is active', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    await expect(provider.getContextUsage({
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toBeNull()
  })

  it('keeps context usage and compact slot state available after a fast Claude Agent stream ends', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createAsyncQuery([
      {
        type: 'result',
        session_id: 'claude-session-fast',
        usage: { input_tokens: 30, output_tokens: 12 },
      },
    ])

    sdkMocks.query.mockReturnValue(activeQuery)

    const runtimeSession = createResumedRuntimeSession({
      providerSessionId: 'claude-session-fast',
    })

    for await (const _chunk of provider.streamTurn({
      runId: 'run-claude-agent-fast-context',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Fast answer'),
      workspaceId: 'workspace-1',
    })) {
      // Drain stream.
    }

    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
    await expect(provider.getContextUsage({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.objectContaining({
      runtimeKind: 'claude-agent',
      providerSessionId: 'claude-session-fast',
      totalTokens: 367,
      source: 'claude-agent-sdk.getContextUsage',
    }))
    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual([
      expect.objectContaining({
        kind: 'compact',
        slotId: 'claude-agent:compact',
        modelContextWindow: 200_000,
        total: expect.objectContaining({ totalTokens: 367 }),
      }),
    ])
    expect(activeQuery.getContextUsage).toHaveBeenCalledOnce()
  })

  it('accumulates usage across multiple streaming messages', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createAsyncQuery([
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello' },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { input_tokens: 0, output_tokens: 25 },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'result',
        usage: { input_tokens: 0, output_tokens: 10 },
        session_id: 'claude-session-1',
      },
    ])

    sdkMocks.query.mockReturnValue(activeQuery)

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Test' }],
      },
      workspaceId: 'workspace-1',
    })) {
      chunks.push(chunk)
    }

    // lastUsage should be the most recent usage
    expect(provider.lastUsage).toEqual({
      promptTokens: 0,
      completionTokens: 10,
      totalTokens: 10,
    })

    // totalUsage should be the sum of all usage
    expect(provider.totalUsage).toEqual({
      promptTokens: 100,
      completionTokens: 85, // 50 + 25 + 10
      totalTokens: 185,
    })
  })
})
