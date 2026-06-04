import { existsSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './app-server-client'
import { CodexProvider } from './provider'

afterEach(() => {
  vi.unstubAllGlobals()
})

class FakeCodexAppServerClient {
  readonly requests: Array<{ method: string, params?: unknown }> = []
  options: CodexAppServerClientOptions
  close = vi.fn()
  initialize = vi.fn(async () => undefined)
  threadStartName: string | null = 'Codex native title'
  threadStartTitle: string | null = null
  threadStartPreview: string | null = null
  threadReadName: string | null = 'Codex native title'
  threadReadTitle: string | null = null
  threadReadPreview: string | null = null
  threadTurnsListData: unknown[] | null = null

  private readonly notifications: CodexAppServerMessage[] = []
  private notificationWaiter: ((message: CodexAppServerMessage | null) => void) | null = null
  private closed = false

  constructor(options: CodexAppServerClientOptions) {
    this.options = options
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'config/read') {
      return {
        config: {
          model: 'gpt-5-codex',
          model_provider: 'openai',
          model_context_window: 200_000,
          model_auto_compact_token_limit: 160_000,
          model_reasoning_effort: 'high',
          model_reasoning_summary: 'auto',
          service_tier: 'priority',
        },
      }
    }
    if (method === 'modelProvider/capabilities/read') {
      return {
        imageGeneration: true,
        namespaceTools: true,
        webSearch: true,
      }
    }
    if (method === 'model/list') {
      return {
        data: [
          {
            id: 'gpt-5-codex',
            model: 'gpt-5-codex',
            displayName: 'GPT-5 Codex',
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Low' },
              { reasoningEffort: 'medium', description: 'Medium' },
              { reasoningEffort: 'high', description: 'High' },
            ],
          },
        ],
        nextCursor: null,
      }
    }
    if (method === 'mcpServerStatus/list') {
      return {
        data: [
          {
            name: 'github',
            tools: { search: {}, read_issue: {} },
            resources: [{ uri: 'repo://cradle' }],
            resourceTemplates: [{ uriTemplate: 'repo://{owner}/{repo}' }],
            authStatus: 'oAuth',
          },
          {
            name: 'linear',
            tools: { issue_search: {} },
            resources: [],
            resourceTemplates: [],
            authStatus: 'notLoggedIn',
          },
        ],
        nextCursor: null,
      }
    }
    if (method === 'account/rateLimits/read') {
      return {
        rateLimits: {
          limitName: 'Pro usage',
          primary: { usedPercent: 91, windowDurationMins: 300, resetsAt: 1_900_000_000 },
          secondary: { usedPercent: 44, windowDurationMins: 10_080, resetsAt: 1_900_000_500 },
          credits: { hasCredits: true, unlimited: false, balance: '12.50' },
          planType: 'pro',
        },
      }
    }
    if (method === 'configRequirements/read') {
      return {
        requirements: {
          allowedApprovalPolicies: ['on-request', 'never'],
          allowedSandboxModes: ['workspace-write', 'read-only'],
          allowedWebSearchModes: ['enabled', 'disabled'],
          featureRequirements: { webSearch: true, imageGeneration: true },
        },
      }
    }
    if (method === 'skills/list') {
      return {
        data: [
          {
            cwd: '/tmp/cradle-workspace',
            skills: [
              { name: 'agent-design', enabled: true },
              { name: 'server-app-development', enabled: true },
              { name: 'disabled-skill', enabled: false },
            ],
            errors: ['invalid skill metadata'],
          },
        ],
      }
    }
    if (method === 'plugin/list') {
      return {
        marketplaces: [
          {
            id: 'personal',
            plugins: [
              { id: 'browser', installed: true, enabled: true },
              { id: 'documents', installed: true, enabled: false },
            ],
          },
        ],
        marketplaceLoadErrors: ['marketplace unavailable'],
      }
    }
    if (method === 'app/list') {
      return {
        data: [
          { id: 'browser', isAccessible: true, isEnabled: true },
          { id: 'hidden', isAccessible: false, isEnabled: true },
        ],
        nextCursor: null,
      }
    }
    if (method === 'collaborationMode/list') {
      return {
        data: [
          { id: 'solo' },
          { id: 'crew' },
        ],
      }
    }
    if (method === 'thread/goal/get') {
      return { goal: null }
    }
    if (method === 'thread/goal/set') {
      const request = params as { threadId: string, objective?: string | null, status?: string | null, tokenBudget?: number | null }
      return {
        goal: {
          threadId: request.threadId,
          objective: request.objective,
          status: request.status ?? 'active',
          tokenBudget: request.tokenBudget ?? null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      }
    }
    if (method === 'thread/start') {
      return {
        thread: {
          id: 'codex-thread-1',
          name: this.threadStartName,
          title: this.threadStartTitle,
          preview: this.threadStartPreview,
          modelProvider: 'openai',
          status: { type: 'active', activeFlags: ['waitingOnApproval'] },
        },
        model: 'gpt-5-codex',
        modelProvider: 'openai',
        serviceTier: 'priority',
        reasoningEffort: 'high',
      }
    }
    if (method === 'thread/resume') {
      return { thread: { id: (params as { threadId?: string }).threadId ?? 'codex-thread-1', name: 'Codex resumed title' } }
    }
    if (method === 'thread/read') {
      const threadId = (params as { threadId?: string }).threadId ?? 'codex-thread-1'
      if (threadId === 'subagent-thread-1') {
        return {
          thread: {
            id: threadId,
            name: 'Review worker',
            preview: 'Review server changes',
            modelProvider: 'openai',
            agentNickname: 'reviewer-1',
            agentRole: 'review',
          },
        }
      }
      return { thread: { id: threadId, name: this.threadReadName, title: this.threadReadTitle, preview: this.threadReadPreview } }
    }
    if (method === 'thread/turns/list') {
      return {
        data: this.threadTurnsListData ?? [
          {
            id: 'history-turn-1',
            itemsView: 'full',
            status: 'completed',
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1000,
            items: [
              {
                type: 'userMessage',
                id: 'history-user-item',
                content: [{ type: 'text', text: 'Earlier Codex request', text_elements: [] }],
              },
              {
                type: 'agentMessage',
                id: 'history-agent-item',
                text: 'Earlier Codex answer',
                phase: null,
                memoryCitation: null,
              },
              {
                type: 'mcpToolCall',
                id: 'history-mcp-item',
                server: 'github',
                tool: 'search',
                status: 'completed',
                arguments: { query: 'cradle' },
                pluginId: null,
                result: { content: [], structuredContent: { total: 1 }, _meta: null },
                error: null,
                durationMs: 12,
              },
            ],
          },
        ],
        nextCursor: null,
        backwardsCursor: null,
      }
    }
    if (method === 'turn/start') {
      return { turn: { id: 'codex-turn-1', status: 'inProgress' } }
    }
    if (method === 'turn/steer') {
      return { turnId: 'codex-turn-1' }
    }
    if (method === 'thread/shellCommand') {
      return {}
    }
    return {}
  }

  async nextNotification(signal?: AbortSignal): Promise<CodexAppServerMessage | null> {
    const next = this.notifications.shift()
    if (next) {
      return next
    }
    if (this.closed) {
      return null
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

  pushNotification(message: CodexAppServerMessage | null): void {
    if (!message) {
      this.closed = true
      if (this.notificationWaiter) {
        const waiter = this.notificationWaiter
        this.notificationWaiter = null
        waiter(null)
      }
      return
    }
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

function createFakeChatgptJwt(input: {
  accountId: string
  planType?: string
  email?: string
}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    encode({ alg: 'none', typ: 'JWT' }),
    encode({
      email: input.email ?? 'user@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: input.accountId,
        chatgpt_plan_type: input.planType ?? 'plus',
      },
    }),
    'sig',
  ].join('.')
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
  it('projects Codex app-server capabilities into provider-owned UI slots', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)

    await expect(provider.getPresentation({
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toMatchObject({
      runtimeKind: 'codex',
      slashCommands: [],
      skills: [],
      uiSlots: expect.arrayContaining([
        expect.objectContaining({ id: 'codex:goal', name: 'goal', iconKey: 'goal', surfaces: ['slashCommand', 'composerState', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:mcp', name: 'mcp', iconKey: 'mcp', surfaces: ['runtimePanel'] }),
        expect.objectContaining({ id: 'codex:review', name: 'review', iconKey: 'code-review', surfaces: ['slashCommand'] }),
        expect.objectContaining({ id: 'codex:compact', name: 'compact', iconKey: 'compact', surfaces: ['slashCommand', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:model', name: 'model', iconKey: 'model', surfaces: ['toolbarPicker', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:reasoning', name: 'reasoning', iconKey: 'reasoning', surfaces: ['toolbarPicker', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:alerts', name: 'alerts', iconKey: 'alert', surfaces: ['runtimePanel'] }),
        expect.objectContaining({ id: 'codex:status', name: 'status', iconKey: 'status', surfaces: ['runtimePanel'] }),
      ]),
    })
  })

  it('projects draft Codex capabilities without starting an app-server session', () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)

    expect(provider.getDraftPresentation()).toMatchObject({
      runtimeKind: 'codex',
      slashCommands: [],
      skills: [],
      uiSlots: expect.arrayContaining([
        expect.objectContaining({ id: 'codex:goal', name: 'goal', iconKey: 'goal', surfaces: ['slashCommand', 'composerState', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:compact', name: 'compact', iconKey: 'compact', surfaces: ['slashCommand', 'runtimePanel'] }),
        expect.objectContaining({ id: 'codex:review', name: 'review', iconKey: 'code-review', surfaces: ['slashCommand'] }),
      ]),
    })
    expect(client.initialize).not.toHaveBeenCalled()
    expect(client.requests).toEqual([])
  })

  it('executes shell commands through Codex thread/shellCommand and returns the native commandExecution result', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const resultPromise = provider.executeShellCommand({
      runtimeSession: createRuntimeSession('codex-thread-1'),
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
      command: 'echo hello',
    })

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toContain('thread/shellCommand')
    })
    expect(client.requests.map(request => request.method).slice(0, 2)).toEqual(['thread/resume', 'thread/shellCommand'])
    expect(client.requests[1]).toEqual({
      method: 'thread/shellCommand',
      params: { threadId: 'codex-thread-1', command: 'echo hello' },
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: {
          type: 'commandExecution',
          id: 'command-1',
          source: 'userShell',
          command: 'echo hello',
          status: 'inProgress',
        },
      },
    })
    client.pushNotification({
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'command-1',
        delta: 'hello\n',
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: {
          type: 'commandExecution',
          id: 'command-1',
          source: 'userShell',
          command: 'echo hello',
          status: 'completed',
          aggregatedOutput: 'hello\n',
          exitCode: 0,
          durationMs: 12,
        },
      },
    })

    await expect(resultPromise).resolves.toEqual({
      command: 'echo hello',
      stdout: 'hello\n',
      stderr: '',
      exitCode: 0,
      durationMs: 12,
      timedOut: false,
      truncated: false,
    })
    expect(client.requests.map(request => request.method)).toContain('thread/turns/list')
    expect(client.close).toHaveBeenCalled()
  })

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

  it('sets goal slash commands through Codex thread goals and continues active goals', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-goal',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('/goal Ship provider-owned slots'),
      workspaceId: 'workspace-1',
    })

    const drainPromise = drainStream(stream)

    await vi.waitFor(() => {
      expect(client.requests).toContainEqual({
        method: 'thread/goal/set',
        params: { threadId: 'codex-thread-1', objective: 'Ship provider-owned slots' },
      })
    })

    expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'thread/goal/set'])
    expect(client.requests[1]).toEqual({
      method: 'thread/goal/set',
      params: { threadId: 'codex-thread-1', objective: 'Ship provider-owned slots' },
    })
    expect(client.requests).not.toContainEqual({
      method: 'turn/start',
      params: expect.anything(),
    })

    await vi.waitFor(() => {
      expect(client.requests).toContainEqual({
        method: 'thread/goal/set',
        params: { threadId: 'codex-thread-1', status: 'active' },
      })
    })
    client.pushNotification({
      method: 'turn/started',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })
    client.pushNotification({
      method: 'thread/status/changed',
      params: {
        threadId: 'codex-thread-1',
        status: { type: 'idle' },
      },
    })
    await vi.waitFor(() => {
      expect(client.requests.filter(request => request.method === 'thread/goal/set')).toHaveLength(3)
    })
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship provider-owned slots',
          status: 'active',
        },
      },
    })

    client.pushNotification({
      method: 'turn/started',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-2', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'thread/goal/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-2',
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship provider-owned slots',
          status: 'complete',
          tokenBudget: null,
          tokensUsed: 10,
          timeUsedSeconds: 2,
          createdAt: 1,
          updatedAt: 3,
        },
      },
    })
    client.pushNotification({
      method: 'thread/goal/cleared',
      params: {
        threadId: 'codex-thread-1',
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-2', status: 'completed' },
      },
    })

    await drainPromise
    expect(client.requests).toContainEqual({
      method: 'thread/goal/clear',
      params: { threadId: 'codex-thread-1' },
    })
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship provider-owned slots',
          status: 'complete',
        },
      },
    })
    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'goal',
        slotId: 'codex:goal',
        threadId: 'codex-thread-1',
        objective: 'Ship provider-owned slots',
        status: 'complete',
      }),
    ]))
  })

  it('sets metadata-projected goal messages through Codex thread goals', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-goal-metadata',
      runtimeSession,
      profile: createProfile(),
      message: {
        id: 'user-goal-metadata',
        role: 'user',
        parts: [{ type: 'text', text: 'Ship metadata-projected goals' }],
        metadata: {
          cradle: {
            goal: { objective: 'Ship metadata-projected goals' },
          },
        },
      },
      workspaceId: 'workspace-1',
    })

    const drainPromise = drainStream(stream)

    await vi.waitFor(() => {
      expect(client.requests).toContainEqual({
        method: 'thread/goal/set',
        params: { threadId: 'codex-thread-1', objective: 'Ship metadata-projected goals' },
      })
    })
    expect(client.requests).not.toContainEqual({
      method: 'turn/start',
      params: expect.anything(),
    })

    client.pushNotification({
      method: 'turn/started',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'thread/goal/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship metadata-projected goals',
          status: 'complete',
          tokenBudget: null,
          tokensUsed: 1,
          timeUsedSeconds: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    })
    client.pushNotification({
      method: 'thread/goal/cleared',
      params: { threadId: 'codex-thread-1' },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await drainPromise
    expect(client.requests).toContainEqual({
      method: 'thread/goal/clear',
      params: { threadId: 'codex-thread-1' },
    })
  })

  it('continues active Codex goals from internal continuation messages without starting a normal turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession('codex-thread-1')
    runtimeSession.providerStateSnapshot = JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: null },
      codex: {
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Resume the active goal',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    })
    const stream = provider.streamTurn({
      runId: 'run-codex-goal-continuation',
      runtimeSession,
      profile: createProfile(),
      message: {
        id: 'internal-goal-continuation',
        role: 'user',
        parts: [{ type: 'text', text: '[internal] Continue the active Codex goal.' }],
        metadata: {
          cradle: {
            codex: { goalContinuation: true },
          },
        },
      },
      workspaceId: 'workspace-1',
    })
    const drainPromise = drainStream(stream)

    await vi.waitFor(() => {
      expect(client.requests).toContainEqual({
        method: 'thread/goal/set',
        params: { threadId: 'codex-thread-1', status: 'active' },
      })
    })
    expect(client.requests.map(request => request.method)).toEqual([
      'thread/resume',
      'thread/turns/list',
      'thread/goal/set',
    ])
    expect(client.requests).not.toContainEqual({
      method: 'turn/start',
      params: expect.anything(),
    })

    client.pushNotification({
      method: 'turn/started',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Continuing',
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })
    client.pushNotification(null)

    await drainPromise
  })

  it('starts compact slash commands through Codex thread compaction', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-compact',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('/compact'),
      workspaceId: 'workspace-1',
    })
    const chunksPromise = (async () => {
      const chunks: UIMessageChunk[] = []
      for await (const chunk of stream) {
        chunks.push(chunk)
      }
      return chunks
    })()

    await vi.waitFor(() => {
      expect(client.requests).toContainEqual({
        method: 'thread/compact/start',
        params: { threadId: 'codex-thread-1' },
      })
    })
    expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'thread/compact/start'])
    expect(client.requests).not.toContainEqual({
      method: 'turn/start',
      params: expect.anything(),
    })

    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'compact-turn-1',
        startedAtMs: 40,
        item: { id: 'compact-1', type: 'contextCompaction' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'compact-turn-1',
        completedAtMs: 50,
        item: { id: 'compact-1', type: 'contextCompaction' },
      },
    })
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'compact-turn-1', status: 'completed' },
      },
    })

    await expect(chunksPromise).resolves.toEqual([
      { type: 'tool-input-start', toolCallId: 'compact-1', toolName: 'context_compaction' },
      { type: 'tool-input-available', toolCallId: 'compact-1', toolName: 'context_compaction', input: codexInput('context_compaction', { id: 'compact-1' }) },
      { type: 'tool-output-available', toolCallId: 'compact-1', output: codexOutput('context_compaction', { id: 'compact-1' }, { id: 'compact-1' }) },
    ])
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        compact: {
          threadId: 'codex-thread-1',
          turnId: 'compact-turn-1',
          status: 'compacted',
          compactionItemId: 'compact-1',
          lastCompactedAt: 50,
        },
      },
    })
  })

  it('projects Codex token usage notifications into compact UI slot state', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession('codex-thread-1')
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Summarize the repo'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.some(request => request.method === 'turn/start')).toBe(true)
    })

    client.pushNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        tokenUsage: {
          total: {
            totalTokens: 128_000,
            inputTokens: 96_000,
            cachedInputTokens: 8_000,
            outputTokens: 24_000,
            reasoningOutputTokens: 8_000,
          },
          last: {
            totalTokens: 4_000,
            inputTokens: 3_000,
            cachedInputTokens: 1_000,
            outputTokens: 1_000,
            reasoningOutputTokens: 250,
          },
          modelContextWindow: 200_000,
        },
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 40,
        item: { id: 'compact-1', type: 'contextCompaction', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        completedAtMs: 50,
        item: { id: 'compact-1', type: 'contextCompaction', status: 'completed' },
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
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await firstChunkPromise
    await drainStream(stream)

    expect(provider.lastUsage).toEqual({
      promptTokens: 3_000,
      completionTokens: 1_000,
      totalTokens: 4_000,
    })
    expect(provider.lastModelId).toBe('gpt-5-codex')

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'compact',
        slotId: 'codex:compact',
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        status: 'compacted',
        compactionItemId: 'compact-1',
        lastCompactedAt: 50,
        autoCompactTokenLimit: 160_000,
        autoCompactPercent: 80,
        usagePercent: 64,
        total: expect.objectContaining({ totalTokens: 128_000 }),
        last: expect.objectContaining({ totalTokens: 4_000 }),
      }),
    ]))
  })

  it('projects Codex status, model, and reasoning into UI slot state', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-runtime-state',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect runtime state'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.some(request => request.method === 'turn/start')).toBe(true)
    })

    client.pushNotification({
      method: 'thread/status/changed',
      params: {
        threadId: 'codex-thread-1',
        status: { type: 'active', activeFlags: ['waitingOnUserInput'] },
      },
    })
    client.pushNotification({
      method: 'thread/settings/updated',
      params: {
        threadId: 'codex-thread-1',
        threadSettings: {
          model: 'gpt-5-codex',
          modelProvider: 'openai',
          serviceTier: 'priority',
          effort: 'high',
          summary: 'auto',
        },
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
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await firstChunkPromise
    await drainStream(stream)

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'status',
        slotId: 'codex:status',
        threadId: 'codex-thread-1',
        status: 'active',
        activeFlags: ['waitingOnUserInput'],
      }),
      expect.objectContaining({
        kind: 'model',
        slotId: 'codex:model',
        threadId: 'codex-thread-1',
        modelId: 'gpt-5-codex',
        modelLabel: 'GPT-5 Codex',
        modelProvider: 'openai',
        serviceTier: 'priority',
        supportsImages: true,
        supportsWebSearch: true,
        supportsNamespaceTools: true,
      }),
      expect.objectContaining({
        kind: 'reasoning',
        slotId: 'codex:reasoning',
        threadId: 'codex-thread-1',
        effort: 'high',
        summary: 'auto',
        supportedEfforts: [
          { id: 'low', description: 'Low' },
          { id: 'medium', description: 'Medium' },
          { id: 'high', description: 'High' },
        ],
      }),
    ]))
  })

  it('projects Codex plan, tool activity, and MCP into UI slot state', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-expanded-slots',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect expanded slots'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.some(request => request.method === 'turn/start')).toBe(true)
    })

    client.pushNotification({
      method: 'turn/plan/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        explanation: 'Work through the repository carefully.',
        plan: [
          { step: 'Inspect current slot contract', status: 'completed' },
          { step: 'Project provider state', status: 'inProgress' },
          { step: 'Render composer state', status: 'pending' },
        ],
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 10,
        item: { id: 'tool-1', type: 'commandExecution', command: 'pnpm test', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        completedAtMs: 20,
        item: { id: 'tool-1', type: 'commandExecution', command: 'pnpm test', status: 'completed' },
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 30,
        item: { id: 'mcp-1', type: 'mcpToolCall', server: 'github', tool: 'search', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'item/mcpToolCall/progress',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'mcp-1',
        message: 'Searching issues',
      },
    })
    client.pushNotification({
      method: 'mcpServer/startupStatus/updated',
      params: {
        name: 'local-dev',
        status: 'failed',
        error: 'Missing command',
      },
    })
    client.pushNotification({
      method: 'mcpServer/oauthLogin/completed',
      params: {
        name: 'linear',
        success: false,
        error: 'Denied',
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
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await firstChunkPromise
    await drainStream(stream)

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'plan',
        slotId: 'codex:plan',
        threadId: 'codex-thread-1',
        currentStep: 'Project provider state',
        pendingCount: 1,
        inProgressCount: 1,
        completedCount: 1,
      }),
      expect.objectContaining({
        kind: 'toolActivity',
        slotId: 'codex:tool-activity',
        threadId: 'codex-thread-1',
        activeCount: 1,
        completedCount: 1,
        failedCount: 0,
        recentItems: expect.arrayContaining([
          expect.objectContaining({ id: 'mcp-1', label: 'github/search', status: 'running' }),
          expect.objectContaining({ id: 'tool-1', label: 'pnpm test', status: 'completed' }),
        ]),
      }),
      expect.objectContaining({
        kind: 'mcp',
        slotId: 'codex:mcp',
        threadId: 'codex-thread-1',
        serverCount: 3,
        readyCount: 1,
        failedCount: 2,
        needsLoginCount: 1,
        recentProgress: 'Searching issues',
        servers: expect.arrayContaining([
          expect.objectContaining({ name: 'github', status: 'ready', authStatus: 'oAuth', toolCount: 2, resourceCount: 2 }),
          expect.objectContaining({ name: 'linear', status: 'failed', authStatus: 'notLoggedIn', error: 'Denied' }),
          expect.objectContaining({ name: 'local-dev', status: 'failed', error: 'Missing command' }),
        ]),
      }),
    ]))

    expect(client.requests.map(request => request.method)).toContain('mcpServerStatus/list')
  })

  it('projects Codex diff, terminal, approvals, and alerts into UI slot state', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-stateful-slots',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect stateful slots'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.some(request => request.method === 'turn/start')).toBe(true)
    })

    client.pushNotification({
      method: 'turn/diff/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        diff: [
          'diff --git a/src/a.ts b/src/a.ts',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1 +1,2 @@',
          '-old',
          '+new',
          '+next',
        ].join('\n'),
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 10,
        item: { id: 'command-1', type: 'commandExecution', command: 'pnpm typecheck', status: 'inProgress' },
      },
    })
    client.pushNotification({
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'command-1',
        delta: 'Typechecking...',
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        completedAtMs: 20,
        item: { id: 'command-1', type: 'commandExecution', command: 'pnpm typecheck', status: 'completed' },
      },
    })
    client.pushNotification({
      method: 'item/autoApprovalReview/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 30,
        reviewId: 'approval-1',
        targetItemId: 'command-1',
        review: { status: 'inProgress', riskLevel: 'medium', rationale: 'Needs command review' },
        action: { type: 'command' },
      },
    })
    client.pushNotification({
      method: 'item/autoApprovalReview/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 30,
        completedAtMs: 40,
        reviewId: 'approval-1',
        targetItemId: 'command-1',
        review: { status: 'approved', riskLevel: 'medium', rationale: 'Approved command' },
        action: { type: 'command' },
      },
    })
    client.pushNotification({
      method: 'warning',
      params: {
        threadId: 'codex-thread-1',
        message: 'Sandbox warning',
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
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await firstChunkPromise
    await drainStream(stream)

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'diff',
        slotId: 'codex:diff',
        threadId: 'codex-thread-1',
        fileCount: 1,
        addedLines: 2,
        removedLines: 1,
        hasDiff: true,
      }),
      expect.objectContaining({
        kind: 'terminal',
        slotId: 'codex:terminal',
        threadId: 'codex-thread-1',
        activeCount: 0,
        completedCount: 1,
        failedCount: 0,
        lastCommand: 'pnpm typecheck',
        lastOutputPreview: 'Typechecking...',
      }),
      expect.objectContaining({
        kind: 'approvals',
        slotId: 'codex:approvals',
        threadId: 'codex-thread-1',
        pendingCount: 0,
        approvedCount: 1,
        deniedCount: 0,
        recentItems: [expect.objectContaining({ id: 'approval-1', status: 'approved', label: 'Command' })],
      }),
      expect.objectContaining({
        kind: 'alert',
        slotId: 'codex:alerts',
        threadId: 'codex-thread-1',
        warningCount: 1,
        errorCount: 0,
        recentItems: [expect.objectContaining({ message: 'Sandbox warning', source: 'warning' })],
      }),
    ]))
  })

  it('projects Codex filesystem, skill, plugin, search, crew, usage, and config summaries into UI slot state', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-lightweight-slots',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Inspect lightweight slots'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.some(request => request.method === 'turn/start')).toBe(true)
    })

    client.pushNotification({
      method: 'fs/changed',
      params: {
        changedPaths: ['/tmp/cradle-workspace/src/a.ts', '/tmp/cradle-workspace/src/b.ts'],
      },
    })
    client.pushNotification({
      method: 'fuzzyFileSearch/sessionUpdated',
      params: {
        threadId: 'codex-thread-1',
        query: 'provider',
        resultCount: 7,
      },
    })
    client.pushNotification({
      method: 'item/started',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        startedAtMs: 10,
        item: {
          id: 'crew-1',
          type: 'collabAgentToolCall',
          text: 'Review server changes',
          status: 'inProgress',
          receiverThreadIds: ['subagent-thread-1'],
          agentsStates: {
            'subagent-thread-1': { status: 'running', message: 'Reading server modules' },
          },
        },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        completedAtMs: 20,
        item: {
          id: 'crew-1',
          type: 'collabAgentToolCall',
          text: 'Review server changes',
          status: 'completed',
          receiverThreadIds: ['subagent-thread-1'],
          agentsStates: {
            'subagent-thread-1': { status: 'completed', message: 'Review finished' },
          },
        },
      },
    })
    client.pushNotification({
      method: 'account/rateLimits/updated',
      params: {
        rateLimits: {
          limitName: 'Pro usage',
          primary: { usedPercent: 73, windowDurationMins: 300, resetsAt: 1_900_000_000 },
          secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: 1_900_000_500 },
          credits: { hasCredits: false, unlimited: false, balance: '0' },
          planType: 'team',
          rateLimitReachedType: 'primary',
        },
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
    client.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })

    await firstChunkPromise
    await drainStream(stream)

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'filesystem',
        slotId: 'codex:filesystem',
        threadId: 'codex-thread-1',
        changedPathCount: 2,
        recentPaths: ['/tmp/cradle-workspace/src/a.ts', '/tmp/cradle-workspace/src/b.ts'],
      }),
      expect.objectContaining({
        kind: 'skills',
        slotId: 'codex:skills',
        threadId: 'codex-thread-1',
        enabledCount: 2,
        disabledCount: 1,
        errorCount: 1,
        roots: ['/tmp/cradle-workspace'],
      }),
      expect.objectContaining({
        kind: 'plugin',
        slotId: 'codex:plugin',
        threadId: 'codex-thread-1',
        installedCount: 2,
        enabledCount: 1,
        appCount: 1,
        marketplaceCount: 1,
        errorCount: 1,
      }),
      expect.objectContaining({
        kind: 'search',
        slotId: 'codex:search',
        threadId: 'codex-thread-1',
        recentQuery: 'provider',
        recentResultCount: 7,
        fuzzySessionActive: true,
      }),
      expect.objectContaining({
        kind: 'crew',
        slotId: 'codex:crew',
        threadId: 'codex-thread-1',
        activeCount: 0,
        completedCount: 1,
        failedCount: 0,
        collaborationModeCount: 2,
        recentItems: [expect.objectContaining({ id: 'crew-1', label: 'Agent', status: 'completed' })],
        calls: [expect.objectContaining({
          agents: [expect.objectContaining({
            threadId: 'subagent-thread-1',
            status: 'completed',
            message: 'Review finished',
            name: 'Review worker',
            preview: 'Review server changes',
            modelProvider: 'openai',
            agentNickname: 'reviewer-1',
            agentRole: 'review',
          })],
        })],
      }),
      expect.objectContaining({
        kind: 'usage',
        slotId: 'codex:usage',
        threadId: 'codex-thread-1',
        limitName: 'Pro usage',
        usedPercent: 91,
        primaryWindowDurationMins: 300,
        primaryResetsAt: 1_900_000_000,
        secondaryUsedPercent: 44,
        secondaryWindowDurationMins: 10_080,
        secondaryResetsAt: 1_900_000_500,
        creditsBalance: '12.50',
        hasCredits: true,
        planType: 'pro',
      }),
      expect.objectContaining({
        kind: 'config',
        slotId: 'codex:config',
        threadId: 'codex-thread-1',
        modelId: 'gpt-5-codex',
        allowedApprovalPolicyCount: 2,
        allowedSandboxModeCount: 2,
        featureRequirementCount: 2,
        webSearchModeCount: 2,
      }),
    ]))

    expect(client.requests.map(request => request.method)).toEqual(expect.arrayContaining([
      'account/rateLimits/read',
      'configRequirements/read',
      'skills/list',
      'plugin/list',
      'app/list',
      'collaborationMode/list',
    ]))
  })

  it('reads Codex crew state from app-server thread history when the live activity snapshot is empty', async () => {
    const client = new FakeCodexAppServerClient({})
    client.threadTurnsListData = [
      {
        id: 'history-turn-with-crew',
        itemsView: 'full',
        status: 'completed',
        error: null,
        startedAt: 10,
        completedAt: 20,
        durationMs: 10_000,
        items: [
          {
            id: 'crew-history-1',
            type: 'collabAgentToolCall',
            tool: 'spawn',
            status: 'completed',
            senderThreadId: 'codex-thread-1',
            receiverThreadIds: ['subagent-thread-1'],
            prompt: 'Review server changes',
            model: 'gpt-5-codex',
            reasoningEffort: 'high',
            agentsStates: {
              'subagent-thread-1': { status: 'completed', message: 'Review finished' },
            },
          },
        ],
      },
    ]
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession('codex-thread-1')

    await expect(provider.getUiSlotStates({
      runtimeSession,
      profile: createProfile(),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/cradle-workspace',
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'crew',
        slotId: 'codex:crew',
        threadId: 'codex-thread-1',
        activeCount: 0,
        completedCount: 1,
        failedCount: 0,
        calls: [expect.objectContaining({
          id: 'crew-history-1',
          tool: 'spawn',
          prompt: 'Review server changes',
          agents: [expect.objectContaining({
            threadId: 'subagent-thread-1',
            status: 'completed',
            message: 'Review finished',
            name: 'Review worker',
            preview: 'Review server changes',
          })],
        })],
      }),
    ]))

    expect(client.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'thread/turns/list',
        params: expect.objectContaining({
          threadId: 'codex-thread-1',
          itemsView: 'full',
          sortDirection: 'desc',
        }),
      }),
      expect.objectContaining({
        method: 'thread/read',
        params: expect.objectContaining({
          threadId: 'subagent-thread-1',
          includeTurns: false,
        }),
      }),
    ]))
  })

  it('projects Codex thread titles into the Cradle session title callback', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const reportSessionTitle = vi.fn()
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-title-projection',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Start the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    expect(reportSessionTitle).toHaveBeenCalledWith('Codex native title')

    client.pushNotification({
      method: 'thread/name/updated',
      params: {
        threadId: 'codex-thread-1',
        threadName: '  Updated Codex title  ',
      },
    })
    await vi.waitFor(() => {
      expect(reportSessionTitle).toHaveBeenCalledWith('Updated Codex title')
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

  it('reads the final Codex thread title after the turn finishes when start and notifications omit it', async () => {
    const client = new FakeCodexAppServerClient({})
    client.threadStartName = null
    client.threadReadName = 'Final Codex title'
    const provider = createProvider(client)
    const reportSessionTitle = vi.fn()
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-final-title',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Start the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })
    expect(reportSessionTitle).not.toHaveBeenCalled()

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

    expect(client.requests.map(request => request.method)).toContain('thread/read')
    expect(reportSessionTitle).toHaveBeenCalledWith('Final Codex title')
  })

  it('uses the Codex thread title field when app-server omits the legacy name field', async () => {
    const client = new FakeCodexAppServerClient({})
    client.threadStartName = null
    client.threadStartTitle = 'Codex stored title'
    const provider = createProvider(client)
    const reportSessionTitle = vi.fn()
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-title-field',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Start the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })
    expect(reportSessionTitle).toHaveBeenCalledWith('Codex stored title')

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

  it('falls back to the final Codex thread preview when name and title are omitted', async () => {
    const client = new FakeCodexAppServerClient({})
    client.threadStartName = null
    client.threadReadName = null
    client.threadReadPreview = 'Final Codex preview'
    const provider = createProvider(client)
    const reportSessionTitle = vi.fn()
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-final-preview-title',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Start the session'),
      workspaceId: 'workspace-1',
      reportSessionTitle,
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })
    expect(reportSessionTitle).not.toHaveBeenCalled()

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

    expect(client.requests.map(request => request.method)).toContain('thread/read')
    expect(reportSessionTitle).toHaveBeenCalledWith('Final Codex preview')
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
      {
        id: 'history-bang-command',
        role: 'user',
        parts: [{ type: 'text', text: '!echo hello' }],
        metadata: {
          cradle: {
            bangCommand: { command: 'echo hello' },
          },
        },
      },
      {
        id: 'history-bang-result',
        role: 'user',
        parts: [{ type: 'text', text: 'hello\n' }],
        metadata: {
          cradle: {
            bangResult: {
              command: 'echo hello',
              stdout: 'hello\n',
              stderr: '',
              exitCode: 0,
              durationMs: 17,
              timedOut: false,
              truncated: false,
            },
          },
        },
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
          {
            type: 'function_call',
            name: 'command_execution',
            arguments: JSON.stringify({ command: 'echo hello' }),
            call_id: 'cradle-bang-history-bang-result',
          },
          {
            type: 'function_call_output',
            call_id: 'cradle-bang-history-bang-result',
            output: JSON.stringify({
              command: 'echo hello',
              output: 'hello\n',
              stdout: 'hello\n',
              stderr: '',
              exitCode: 0,
              code: 0,
              durationMs: 17,
              timedOut: false,
              truncated: false,
            }),
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

  it('injects previous Codex native history before starting a fresh replacement thread', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const previousProviderStateSnapshot = JSON.stringify({
      workspacePath: '/tmp/cradle-workspace',
      models: { currentModelId: 'gpt-5-codex' },
      codex: {
        nativeHistory: {
          threadId: 'previous-thread',
          itemsView: 'full',
          fetchedAt: 10,
          complete: true,
          turnCount: 1,
          itemCount: 4,
          nextCursor: null,
          error: null,
          turns: [
            {
              id: 'previous-turn-1',
              itemsView: 'full',
              status: 'completed',
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1000,
              items: [
                {
                  type: 'userMessage',
                  id: 'previous-user-item',
                  content: [{ type: 'text', text: 'Earlier Codex request', text_elements: [] }],
                },
                {
                  type: 'reasoning',
                  id: 'previous-reasoning-item',
                  summary: ['I checked the prior native history.'],
                  content: ['The important fact is already known.'],
                },
                {
                  type: 'agentMessage',
                  id: 'previous-agent-item',
                  text: 'Earlier Codex answer',
                  phase: null,
                  memoryCitation: null,
                },
                {
                  type: 'mcpToolCall',
                  id: 'previous-mcp-item',
                  server: 'github',
                  tool: 'search',
                  status: 'completed',
                  arguments: { query: 'cradle' },
                  pluginId: null,
                  result: { content: [], structuredContent: { total: 1 }, _meta: null },
                  error: null,
                  durationMs: 12,
                },
              ],
            },
          ],
        },
      },
    })
    const runtimeSession = await provider.startChatSession({
      chatSessionId: 'chat-session-1',
      profile: createProfile(),
      workspacePath: '/tmp/cradle-workspace',
      modelId: 'gpt-5-codex',
      previousProviderStateSnapshot,
    })

    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        previousNativeHistory: {
          threadId: 'previous-thread',
          itemsView: 'full',
          turnCount: 1,
          itemCount: 4,
        },
      },
    })

    const stream = provider.streamTurn({
      runId: 'run-codex-native-history-reconstruction',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Continue from native history'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method).slice(0, 3)).toEqual(['thread/start', 'thread/inject_items', 'turn/start'])
    })

    expect(client.requests[1]).toEqual({
      method: 'thread/inject_items',
      params: {
        threadId: 'codex-thread-1',
        items: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Earlier Codex request' }],
          },
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'I checked the prior native history.' }],
            content: [{ type: 'reasoning_text', text: 'The important fact is already known.' }],
            encrypted_content: null,
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Earlier Codex answer' }],
          },
          {
            type: 'function_call',
            name: 'github/search',
            arguments: JSON.stringify({ query: 'cradle' }),
            call_id: 'previous-mcp-item',
          },
          {
            type: 'function_call_output',
            call_id: 'previous-mcp-item',
            output: JSON.stringify({
              server: 'github',
              tool: 'search',
              result: { content: [], structuredContent: { total: 1 }, _meta: null },
              content: [],
            }),
          },
        ],
      },
    })

    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Recovered native history',
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

  it('logs into Codex app-server with ChatGPT auth tokens without API key env', async () => {
    const accessToken = createFakeChatgptJwt({ accountId: 'workspace-1', planType: 'plus' })
    const appServerOptions: CodexAppServerClientOptions[] = []
    const clients: FakeCodexAppServerClient[] = []
    const provider = new CodexProvider({
      readSecret: () => JSON.stringify({
        kind: 'chatgpt-auth',
        accessToken,
        refreshToken: 'refresh-token-1',
        chatgptAccountId: 'workspace-1',
        chatgptPlanType: 'plus',
      }),
      updateSecret: vi.fn(),
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
      runId: 'run-codex-chatgpt-auth',
      runtimeSession: createRuntimeSession(),
      profile: {
        ...createProfile({ apiKey: undefined, baseUrl: undefined }),
        credentialRef: 'credential-chatgpt',
      },
      message: createUserMessage('Use ChatGPT auth'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(clients[0]?.requests.map(request => request.method).slice(0, 3)).toEqual([
        'account/login/start',
        'thread/start',
        'turn/start',
      ])
    })

    expect(appServerOptions[0]?.apiKey).toBeUndefined()
    expect(clients[0]?.requests[0]).toEqual({
      method: 'account/login/start',
      params: {
        type: 'chatgptAuthTokens',
        accessToken,
        chatgptAccountId: 'workspace-1',
        chatgptPlanType: 'plus',
      },
    })

    clients[0]?.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Done',
      },
    })
    await firstChunkPromise
    clients[0]?.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })
    await drainStream(stream)
  })

  it('refreshes ChatGPT auth token requests and updates the credential secret', async () => {
    const accessToken = createFakeChatgptJwt({ accountId: 'workspace-1', planType: 'plus' })
    const refreshedAccessToken = createFakeChatgptJwt({ accountId: 'workspace-1', planType: 'pro' })
    const updateSecret = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: refreshedAccessToken,
      refresh_token: 'refresh-token-2',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const client = new FakeCodexAppServerClient({})
    const provider = new CodexProvider({
      readSecret: () => JSON.stringify({
        kind: 'chatgpt-auth',
        accessToken,
        refreshToken: 'refresh-token-1',
        chatgptAccountId: 'workspace-1',
        chatgptPlanType: 'plus',
      }),
      updateSecret,
      resolveSkillPaths: () => ['/tmp/cradle-skill'],
      recordObservability: vi.fn(),
      createAppServerClient: (options) => {
        client.options = options
        return client
      },
    })
    const stream = provider.streamTurn({
      runId: 'run-codex-chatgpt-refresh',
      runtimeSession: createRuntimeSession(),
      profile: {
        ...createProfile({ apiKey: undefined, baseUrl: undefined }),
        credentialRef: 'credential-chatgpt',
      },
      message: createUserMessage('Use ChatGPT auth'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toContain('turn/start')
    })

    await expect(client.pushServerRequest({
      id: 100,
      method: 'account/chatgptAuthTokens/refresh',
      params: { reason: 'unauthorized', previousAccountId: 'workspace-1' },
    })).resolves.toEqual({
      accessToken: refreshedAccessToken,
      chatgptAccountId: 'workspace-1',
      chatgptPlanType: 'pro',
    })
    expect(updateSecret).toHaveBeenCalledWith('credential-chatgpt', expect.stringContaining('"refreshToken":"refresh-token-2"'))

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
    await drainStream(stream)
  })

  it('passes Cradle session context into the Codex app-server environment', async () => {
    const appServerOptions: CodexAppServerClientOptions[] = []
    const clients: FakeCodexAppServerClient[] = []
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
      profile: createProfile(),
      message: createUserMessage('Use Cradle context'),
      workspaceId: 'workspace-1',
    })
    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(appServerOptions[0]?.env).toEqual({
        CRADLE_CHAT_SESSION_ID: 'chat-session-1',
        CRADLE_WORKSPACE_ID: 'workspace-1',
        CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
      })
    })

    clients[0]?.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Done',
      },
    })
    await firstChunkPromise
    clients[0]?.pushNotification({
      method: 'turn/completed',
      params: {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-turn-1', status: 'completed' },
      },
    })
    await drainStream(stream)
  })

  it('runs agent-scoped Codex threads from the agent home while keeping workspace roots explicit', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'cradle-codex-agent-home-'))
    const previousHome = process.env.HOME
    process.env.HOME = homeDir

    const appServerOptions: CodexAppServerClientOptions[] = []
    const clients: FakeCodexAppServerClient[] = []
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

    try {
      const runtimeSession = createRuntimeSession()
      runtimeSession.providerStateSnapshot = JSON.stringify({
        workspacePath: '/tmp/cradle-workspace',
        agentId: 'agent-007',
        models: { currentModelId: null },
      })
      const stream = provider.streamTurn({
        runId: 'run-codex-test',
        runtimeSession,
        profile: createProfile(),
        message: createUserMessage('Use agent home'),
        workspaceId: 'workspace-1',
        agentId: 'agent-007',
      })
      const firstChunkPromise = stream.next()

      const agentHome = join(homeDir, '.cradle', 'agents', 'agent-007')
      await vi.waitFor(() => {
        expect(clients[0]?.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
      })
      expect(appServerOptions[0]?.env).toEqual({
        CRADLE_CHAT_SESSION_ID: 'chat-session-1',
        CRADLE_WORKSPACE_ID: 'workspace-1',
        CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
        CRADLE_AGENT_ID: 'agent-007',
        CRADLE_AGENT_HOME: agentHome,
      })
      expect(clients[0]?.requests[0]).toEqual({
        method: 'thread/start',
        params: expect.objectContaining({
          cwd: agentHome,
          runtimeWorkspaceRoots: [agentHome, '/tmp/cradle-workspace'],
        }),
      })
      expect(clients[0]?.requests[1]).toEqual({
        method: 'turn/start',
        params: expect.objectContaining({
          cwd: agentHome,
          runtimeWorkspaceRoots: [agentHome, '/tmp/cradle-workspace'],
          sandboxPolicy: {
            type: 'dangerFullAccess',
          },
        }),
      })
      expect(existsSync(join(agentHome, 'skills'))).toBe(true)
      expect(readlinkSync(join(agentHome, '.agents', 'skills'))).toBe('../skills')
      expect(readlinkSync(join(agentHome, '.claude', 'skills'))).toBe('../skills')

      clients[0]?.pushNotification({
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'codex-turn-1',
          itemId: 'assistant-message-1',
          delta: 'Done',
        },
      })
      await firstChunkPromise
      clients[0]?.pushNotification({
        method: 'turn/completed',
        params: {
          threadId: 'codex-thread-1',
          turn: { id: 'codex-turn-1', status: 'completed' },
        },
      })
      await drainStream(stream)
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

  it('pauses an active Codex goal before interrupting a cancelled turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-cancel-goal',
      runtimeSession,
      profile: createProfile(),
      message: createUserMessage('Keep working on the active goal'),
      workspaceId: 'workspace-1',
    })

    const firstChunkPromise = stream.next()

    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method)).toEqual(['thread/start', 'turn/start'])
    })

    client.pushNotification({
      method: 'thread/goal/updated',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship provider-owned slots',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Working',
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: expect.objectContaining({ type: 'text-start' }),
    })

    await provider.cancelTurn({
      runtimeSession,
      profile: createProfile(),
    })

    expect(client.requests.slice(-2)).toEqual([
      {
        method: 'thread/goal/set',
        params: { threadId: 'codex-thread-1', status: 'paused' },
      },
      {
        method: 'turn/interrupt',
        params: { threadId: 'codex-thread-1', turnId: 'codex-turn-1' },
      },
    ])
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        goal: {
          threadId: 'codex-thread-1',
          objective: 'Ship provider-owned slots',
          status: 'paused',
        },
      },
    })
    expect(client.close).toHaveBeenCalledOnce()
    await stream.return(undefined)
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
    }).rejects.toThrow('Codex provider only supports text, image, and skill input; unsupported parts: file (brief.pdf) (application/pdf)')

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

    let thrownError: unknown = null
    try {
      await drainPromise
    }
    catch (error) {
      thrownError = error
    }

    expect(thrownError).toMatchObject({
      name: 'CodexProviderError',
      code: 'TURN_STREAM_FAILED',
      message: 'Upstream model request failed',
      data: {
        details: 'provider code: invalid_request; events: 1 total, 0 mapped; event types: error:1',
        diagnostics: {
          totalEvents: 1,
          mappedEvents: 0,
          retryableErrorEvents: 0,
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
    expect(thrownError).toBeInstanceOf(Error)
    expect((thrownError as Error).message).not.toContain('raw=')
    expect((thrownError as Error).message).not.toContain('event_types=')
  })

  it('keeps streaming when Codex app-server reports a retryable transport error', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession()
    const stream = provider.streamTurn({
      runId: 'run-codex-retryable-error',
      runtimeSession,
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
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).not.toMatchObject({
      codex: {
        alert: {
          recentItems: [expect.objectContaining({ message: 'Reconnecting... 1/5' })],
        },
      },
    })
  })

  it('summarizes final retry-limit failures without exposing raw event diagnostics in the user-facing message', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-final-retry-limit',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Fail after reconnect attempts'),
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
          message: 'Reconnecting... 1/5',
          codexErrorInfo: null,
          additionalDetails: 'stream disconnected before completion: stream closed before response.completed',
        },
        willRetry: true,
      },
    })
    client.pushNotification({
      method: 'error',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        error: {
          message: 'Reconnecting... 2/5',
          codexErrorInfo: null,
          additionalDetails: 'unexpected status 502 Bad Gateway',
        },
        willRetry: true,
      },
    })
    client.pushNotification({
      method: 'error',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        error: {
          message: 'exceeded retry limit, last status: 429 Too Many Requests, request id: fe7e7cae-a49f-4bd9-b493-6bf74c121526',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        willRetry: false,
      },
    })

    let thrownError: unknown = null
    try {
      await drainPromise
    }
    catch (error) {
      thrownError = error
    }

    expect(thrownError).toMatchObject({
      name: 'CodexProviderError',
      code: 'TURN_STREAM_FAILED',
      message: 'Codex app-server retry limit exceeded',
      data: {
        details: 'status: 429 Too Many Requests; request id: fe7e7cae-a49f-4bd9-b493-6bf74c121526; retryable errors observed before failure: 2; events: 3 total, 0 mapped; event types: error:3',
        diagnostics: {
          totalEvents: 3,
          mappedEvents: 0,
          retryableErrorEvents: 2,
          eventTypeCounts: { error: 3 },
        },
      },
    })
    expect(thrownError).toBeInstanceOf(Error)
    expect((thrownError as Error).message).not.toContain('raw=')
    expect((thrownError as Error).message).not.toContain('events_total=')
  })

  it('resumes existing app-server threads before starting the turn', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const runtimeSession = createRuntimeSession('existing-thread')
    const stream = provider.streamTurn({
      runId: 'run-codex-test',
      runtimeSession,
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
    await vi.waitFor(() => {
      expect(client.requests.map(request => request.method).slice(0, 3)).toEqual([
        'thread/resume',
        'thread/turns/list',
        'turn/start',
      ])
    })
    expect(client.requests[1]).toEqual({
      method: 'thread/turns/list',
      params: {
        threadId: 'existing-thread',
        cursor: null,
        limit: 100,
        sortDirection: 'asc',
        itemsView: 'full',
      },
    })
    expect(JSON.parse(runtimeSession.providerStateSnapshot ?? '{}')).toMatchObject({
      codex: {
        nativeHistory: {
          threadId: 'existing-thread',
          itemsView: 'full',
          complete: true,
          turnCount: 1,
          itemCount: 3,
          turns: [
            {
              id: 'history-turn-1',
              itemsView: 'full',
              items: [
                { type: 'userMessage', id: 'history-user-item' },
                { type: 'agentMessage', id: 'history-agent-item', text: 'Earlier Codex answer' },
                { type: 'mcpToolCall', id: 'history-mcp-item', server: 'github', tool: 'search' },
              ],
            },
          ],
        },
      },
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

    expect(client.requests.map(request => request.method).slice(0, 3)).toEqual([
      'thread/resume',
      'thread/turns/list',
      'turn/start',
    ])
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

  it('does not emit visible reasoning chunks for encrypted-only reasoning items', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-encrypted-reasoning',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Encrypted reasoning'),
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
        item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: null, encrypted_content: 'encrypted' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: null, encrypted_content: 'encrypted' },
      },
    })
    client.pushNotification({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        itemId: 'assistant-message-1',
        delta: 'Visible answer.',
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
      { type: 'text-delta', id: 'assistant-message-1', delta: 'Visible answer.' },
      { type: 'text-end', id: 'assistant-message-1' },
    ])
  })

  it('emits reasoning when a completed snapshot adds displayable content', async () => {
    const client = new FakeCodexAppServerClient({})
    const provider = createProvider(client)
    const stream = provider.streamTurn({
      runId: 'run-codex-reasoning-snapshot',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Reasoning snapshot'),
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
        item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: null, encrypted_content: 'encrypted' },
      },
    })
    client.pushNotification({
      method: 'item/completed',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'codex-turn-1',
        item: { id: 'reasoning-1', type: 'reasoning', summary: [], content: ['Displayable thought.'], encrypted_content: 'encrypted' },
      },
    })

    await expect(firstChunkPromise).resolves.toEqual({
      done: false,
      value: { type: 'reasoning-start', id: 'reasoning-1' },
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
      { type: 'reasoning-delta', id: 'reasoning-1', delta: 'Displayable thought.' },
      { type: 'reasoning-end', id: 'reasoning-1' },
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
