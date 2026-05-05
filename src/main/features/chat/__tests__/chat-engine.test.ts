// Input: ChatEngine, mocked provider catalog, mocked backend control plane, and in-memory DB fakes
// Output: Integration-style regression test for ChatEngine binding/run orchestration
// Position: Chat feature regression guard for control-plane-backed turn lifecycle

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../../db/schema'
import { createInMemoryDomainEventBus } from '../../../events/domain-event-bus'
import { chatEngine } from '../chat-engine'
import { createBroadcastSubscriber } from '../subscribers/broadcast-subscriber'

type FakeDbState = {
  agentProfiles: Array<typeof schema.agentProfiles.$inferSelect>
  agents: Array<typeof schema.agents.$inferSelect>
  backendRuns: Array<typeof schema.backendRuns.$inferSelect>
  backendTimelineEvents: Array<typeof schema.backendTimelineEvents.$inferSelect>
  sessions: Array<typeof schema.sessions.$inferSelect>
  messages: Array<typeof schema.messages.$inferSelect>
  usageLogs: Array<typeof schema.usageLogs.$inferSelect>
  workspaces: Array<typeof schema.workspaces.$inferSelect>
}

type BindingRecord = {
  id: string
  chatSessionId: string
  agentProfileId: string
  providerKind: 'acp-chat' | 'cli-tui' | 'openai-compatible'
  backendSessionId: string | null
  backendStateSnapshot: string | null
  requestedModelId: string | null
}

type RunRecord = {
  id: string
  chatSessionId: string
  messageId: string | null
  origin: 'user' | 'issue-agent' | 'system'
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  stopReason: string | null
  errorText: string | null
}

type TimelineRecord = {
  id: string
  runId: string
  chatSessionId: string
  sequenceNumber: number
  type: string
}

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getProviderCatalog: vi.fn(),
  getBackendControlPlaneService: vi.fn(),
  recordAgentContext: vi.fn(),
  indexMessage: vi.fn(),
  observePush: vi.fn(),
  readBundledResource: vi.fn(),
  scanSkills: vi.fn(),
  buildSkillCatalog: vi.fn(),
}))

vi.mock('../../../db', () => ({
  getDb: mocks.getDb,
}))

vi.mock('../../agent-runtime/catalog-instance', () => ({
  getProviderCatalog: mocks.getProviderCatalog,
}))

vi.mock('../../backend-control-plane/backend-control-plane', () => ({
  getBackendControlPlaneService: mocks.getBackendControlPlaneService,
}))

vi.mock('../../../devtools/agent-context-devtool-store', () => ({
  getAgentContextDevtoolStore: () => ({
    record: mocks.recordAgentContext,
  }),
}))

vi.mock('../../../platform/resources/bundled-resources', () => ({
  readBundledResource: mocks.readBundledResource,
}))

vi.mock('../../skills/skills', () => ({
  scanSkills: mocks.scanSkills,
  buildSkillCatalog: mocks.buildSkillCatalog,
}))

vi.mock('../thread-search', () => ({
  ThreadSearchEngine: {
    getInstance: () => ({
      indexMessage: mocks.indexMessage,
      removeSessionFromIndex: vi.fn(),
    }),
  },
}))

vi.mock('../../../platform/acp/acp-connection', () => ({
  AcpConnectionManager: {
    getInstance: () => ({
      onSessionTitle: () => () => {},
    }),
  },
}))

vi.mock('@cradle/ipc', () => ({
  observePush: mocks.observePush,
}))

function createFakeDb(state: FakeDbState) {
  const now = 1_700_000_000

  const insertRow = (table: unknown, row: Record<string, unknown>) => {
    if (table === schema.sessions) {
      const inserted: typeof schema.sessions.$inferSelect = {
        id: String(row.id),
        workspaceId: String(row.workspaceId),
        title: String(row.title),
        agentProfileId: String(row.agentProfileId),
        agentId: (row.agentId as string | null | undefined) ?? null,
        linkedIssueId: (row.linkedIssueId as string | null | undefined) ?? null,
        pinned: (row.pinned as number | undefined) ?? 0,
        createdAt: (row.createdAt as number | undefined) ?? now,
        updatedAt: (row.updatedAt as number | undefined) ?? now,
      }
      state.sessions.push(inserted)
      return inserted
    }

    if (table === schema.messages) {
      const inserted: typeof schema.messages.$inferSelect = {
        id: String(row.id),
        sessionId: String(row.sessionId),
        role: row.role as 'user' | 'assistant',
        status: row.status as 'streaming' | 'complete' | 'aborted' | 'failed',
        content: String(row.content),
        errorText: (row.errorText as string | null | undefined) ?? null,
        createdAt: (row.createdAt as number | undefined) ?? now,
        updatedAt: (row.updatedAt as number | undefined) ?? now,
      }
      state.messages.push(inserted)
      return inserted
    }

    if (table === schema.usageLogs) {
      const inserted: typeof schema.usageLogs.$inferSelect = {
        id: String(row.id),
        sessionId: String(row.sessionId),
        messageId: (row.messageId as string | null | undefined) ?? null,
        agentProfileId: (row.agentProfileId as string | null | undefined) ?? null,
        modelId: (row.modelId as string | null | undefined) ?? null,
        promptTokens: Number(row.promptTokens ?? 0),
        completionTokens: Number(row.completionTokens ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        createdAt: (row.createdAt as number | undefined) ?? now,
      }
      state.usageLogs.push(inserted)
      return inserted
    }

    if (table === schema.backendTimelineEvents) {
      const inserted: typeof schema.backendTimelineEvents.$inferSelect = {
        id: String(row.id),
        runId: String(row.runId),
        chatSessionId: String(row.chatSessionId),
        sequenceNumber: Number(row.sequenceNumber),
        eventType: String(row.eventType),
        schemaVersion: String(row.schemaVersion),
        payloadJson: String(row.payloadJson),
        sourceJson: String(row.sourceJson),
        createdAt: Number(row.createdAt ?? now),
      }
      state.backendTimelineEvents.push(inserted)
      return inserted
    }

    throw new Error('Unsupported table insert in fake DB')
  }

  const updateRows = (table: unknown, values: Record<string, unknown>) => {
    if (table === schema.sessions) {
      const target = state.sessions[0]
      if (!target) {
        return
      }
      Object.assign(target, values)
      return
    }

    if (table === schema.messages) {
      const target = [...state.messages].reverse().find(message => message.role === 'assistant')
      if (!target) {
        return
      }
      Object.assign(target, values)
      return
    }

    if (table === schema.backendRuns) {
      const target = state.backendRuns.at(-1)
      if (!target) {
        return
      }
      Object.assign(target, values)
    }
  }

  const selectRows = (table: unknown) => {
    if (table === schema.agentProfiles) {
      return state.agentProfiles
    }
    if (table === schema.agents) {
      return state.agents
    }
    if (table === schema.sessions) {
      return state.sessions
    }
    if (table === schema.backendRuns) {
      return state.backendRuns
    }
    if (table === schema.backendTimelineEvents) {
      return state.backendTimelineEvents
    }
    if (table === schema.messages) {
      return state.messages
    }
    if (table === schema.workspaces) {
      return state.workspaces
    }
    if (table === schema.usageLogs) {
      return state.usageLogs
    }
    return []
  }

  const tx = {
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          const inserted = insertRow(table, value)
          return {
            run() {
              return inserted
            },
            returning() {
              return {
                get() {
                  return inserted
                },
              }
            },
          }
        },
      }
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                run() {
                  updateRows(table, values)
                },
              }
            },
          }
        },
      }
    },
    select(selection?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const rows = selectRows(table)
          let ordered = false
          return {
            where() {
              return this
            },
            orderBy() {
              ordered = true
              return this
            },
            get() {
              if (selection && table === schema.messages) {
                const first = rows[0] as typeof schema.messages.$inferSelect | undefined
                return first ? { sessionId: first.sessionId } : undefined
              }
              if (ordered && table === schema.backendTimelineEvents) {
                return rows.at(-1)
              }
              return rows[0]
            },
            all() {
              if (selection && table === schema.messages) {
                return rows.map(row => ({ sessionId: (row as typeof schema.messages.$inferSelect).sessionId }))
              }
              return rows
            },
          }
        },
      }
    },
    transaction<T>(fn: (db: typeof tx) => T): T {
      return fn(tx)
    },
  }

  return tx
}

function createControlPlaneHarness(state: FakeDbState) {
  const bindings = new Map<string, BindingRecord>()
  const runs = new Map<string, RunRecord>()
  const timeline = new Map<string, TimelineRecord[]>()
  const snapshots: Array<{ agentProfileId: string, providerKind: string, source: string, capabilitiesJson: string }> = []

  const service = {
    getBinding(chatSessionId: string) {
      return bindings.get(chatSessionId)
    },
    listBindingsByBackendSessionId(backendSessionId: string) {
      return [...bindings.values()].filter(binding => binding.backendSessionId === backendSessionId)
    },
    attachBinding(input: Omit<BindingRecord, 'id'>) {
      const existing = bindings.get(input.chatSessionId)
      const binding: BindingRecord = {
        id: existing?.id ?? `binding-${bindings.size + 1}`,
        ...input,
      }
      bindings.set(input.chatSessionId, binding)
      return binding
    },
    startRun(input: { chatSessionId: string, messageId: string | null, origin: RunRecord['origin'] }) {
      const run: RunRecord = {
        id: `run-${runs.size + 1}`,
        chatSessionId: input.chatSessionId,
        messageId: input.messageId,
        origin: input.origin,
        status: 'streaming',
        stopReason: null,
        errorText: null,
      }
      runs.set(run.id, run)
      state.backendRuns.push({
        id: run.id,
        bindingId: `binding-${bindings.size}`,
        chatSessionId: run.chatSessionId,
        messageId: run.messageId,
        origin: run.origin,
        status: run.status,
        stopReason: run.stopReason,
        errorText: run.errorText,
        startedAt: 1_700_000_000,
        finishedAt: null,
      })
      return run
    },
    finishRun(input: { runId: string, status: RunRecord['status'], stopReason?: string | null, errorText?: string | null }) {
      const existing = runs.get(input.runId)
      if (!existing) {
        throw new Error(`Missing run ${input.runId}`)
      }
      const finished: RunRecord = {
        ...existing,
        status: input.status,
        stopReason: input.stopReason ?? null,
        errorText: input.errorText ?? null,
      }
      runs.set(input.runId, finished)
      const target = state.backendRuns.find(run => run.id === input.runId)
      if (target) {
        Object.assign(target, {
          status: input.status,
          stopReason: input.stopReason ?? null,
          errorText: input.errorText ?? null,
          finishedAt: 1_700_000_100,
        })
      }
      return finished
    },
    recordCapabilitySnapshot(input: { agentProfileId: string, providerKind: string, source: string, capabilitiesJson: string }) {
      snapshots.push(input)
      return { id: `snapshot-${snapshots.length}`, ...input, recordedAt: 1_700_000_000 }
    },
    appendTimelineEvent(input: { chatSessionId: string, runId: string, event: { type: string } }) {
      const existing = timeline.get(input.runId) ?? []
      const event: TimelineRecord & Record<string, unknown> = {
        id: `timeline-${existing.length + 1}`,
        runId: input.runId,
        chatSessionId: input.chatSessionId,
        sequenceNumber: existing.length,
        schemaVersion: 'cradle.timeline.v1',
        createdAt: 1_700_000_000,
        ...input.event,
      }
      existing.push(event)
      timeline.set(input.runId, existing)
      return event
    },
    listTimelineEvents(runId: string) {
      return timeline.get(runId) ?? []
    },
  }

  return {
    service,
    bindings,
    runs,
    timeline,
    snapshots,
  }
}

function createFakeWebContents() {
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    once: vi.fn(),
  }
}

describe('chatEngine', () => {
  let state: FakeDbState
  let controlPlane: ReturnType<typeof createControlPlaneHarness>
  let mockBroadcaster: { broadcastGlobal: ReturnType<typeof vi.fn>, broadcastFiltered: ReturnType<typeof vi.fn>, subscribe: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    state = {
      agentProfiles: [{
        id: 'profile-1',
        name: 'ACP Profile',
        providerKind: 'acp-chat',
        enabled: true,
        configJson: '{}',
        credentialRef: null,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
      }],
      agents: [],
      backendRuns: [],
      backendTimelineEvents: [],
      sessions: [],
      messages: [],
      usageLogs: [],
      workspaces: [{
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
      }],
    }
    controlPlane = createControlPlaneHarness(state)

    mocks.getDb.mockReturnValue(createFakeDb(state))
    mocks.getBackendControlPlaneService.mockReturnValue(controlPlane.service)
    mocks.recordAgentContext.mockReset()
    mocks.indexMessage.mockReset()
    mocks.observePush.mockReset()
    mocks.readBundledResource.mockReturnValue(null)
    mocks.scanSkills.mockReturnValue([])
    mocks.buildSkillCatalog.mockReturnValue('')
    mocks.getProviderCatalog.mockReturnValue({
      get: () => ({
        providerKind: 'acp-chat' as const,
        probe: async () => ({ ok: true, label: 'ACP', version: '1.0.0', details: {}, errorText: null }),
        listModels: async () => [],
        startChatSession: async () => ({
          id: 'backend-session-1',
          chatSessionId: 'chat-ignored',
          agentProfileId: 'profile-1',
          providerKind: 'acp-chat' as const,
          providerSessionId: 'backend-session-1',
          providerStateSnapshot: JSON.stringify({
            models: { currentModelId: 'claude-4' },
            configOptions: [{ id: 'thinking', currentValue: 'high' }],
          }),
        }),
        resumeChatSession: async () => {
          throw new Error('resume not expected in this test')
        },
        streamTurn: async function* streamTurn() {
          yield {
            type: 'assistant.message.started',
            itemId: 'assistant-1',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
          yield {
            type: 'assistant.text.delta',
            itemId: 'assistant-1',
            delta: '你好',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
        },
        cancelTurn: async () => {},
        lastUsage: null,
      }),
    })

    // Wire event bus + broadcast subscriber so domain events reach IPC
    const eventBus = createInMemoryDomainEventBus()
    chatEngine.bindEventBus(eventBus)
    mockBroadcaster = {
      broadcastGlobal: vi.fn(),
      broadcastFiltered: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    }
    createBroadcastSubscriber({
      eventBus,
      broadcaster: mockBroadcaster as never,
      getSessionWatchers: () => chatEngine.getSessionWatchers(),
    })
  })

  afterEach(() => {
    chatEngine.destroy()
    vi.clearAllMocks()
  })

  it('creates a binding and completes a backend run for one prompt', async () => {
    const sessionId = await chatEngine.createAndSend({
      agentId: 'profile-1',
      workspaceId: 'workspace-1',
      cwd: '/tmp/workspace',
      text: '你好，世界',
      modelId: 'claude-4',
    })

    await vi.waitFor(() => {
      expect(state.backendRuns[0]?.status).toBe('complete')
    })

    const binding = controlPlane.bindings.get(sessionId)
    const run = state.backendRuns[0]

    expect(binding).toEqual(
      expect.objectContaining({
        chatSessionId: sessionId,
        agentProfileId: 'profile-1',
        providerKind: 'acp-chat',
        backendSessionId: 'backend-session-1',
        requestedModelId: 'claude-4',
      }),
    )
    expect(run).toEqual(
      expect.objectContaining({
        chatSessionId: sessionId,
        origin: 'user',
        status: 'complete',
        stopReason: 'response.completed',
      }),
    )
    expect(controlPlane.snapshots).toEqual([
      expect.objectContaining({
        agentProfileId: 'profile-1',
        providerKind: 'acp-chat',
        source: 'session_start',
      }),
    ])
    // Verify timeline events were broadcast through the unified signal bridge
    const anyTimelineBroadcast = mockBroadcaster.broadcastFiltered.mock.calls.some(([topic]) => topic === 'chat:timeline-event')
      || mockBroadcaster.broadcastGlobal.mock.calls.some(([topic]) => topic === 'chat:session-activity')
    expect(anyTimelineBroadcast).toBe(true)
    expect(mockBroadcaster.broadcastFiltered.mock.calls.some(([topic]) => topic === 'chat:response-event')).toBe(false)
    expect(state.sessions[0]?.id).toBe(sessionId)
    expect(state.messages).toHaveLength(2)
  })

  it('persists the assistant snapshot as soon as a timeline delta is stored', async () => {
    let releaseTurn: (() => void) | undefined
    const turnBlocked = new Promise<void>((resolve) => {
      releaseTurn = () => resolve()
    })

    mocks.getProviderCatalog.mockReturnValue({
      get: () => ({
        providerKind: 'acp-chat' as const,
        probe: async () => ({ ok: true, label: 'ACP', version: '1.0.0', details: {}, errorText: null }),
        listModels: async () => [],
        startChatSession: async () => ({
          id: 'backend-session-1',
          chatSessionId: 'chat-ignored',
          agentProfileId: 'profile-1',
          providerKind: 'acp-chat' as const,
          providerSessionId: 'backend-session-1',
          providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'claude-4' } }),
        }),
        resumeChatSession: async () => {
          throw new Error('resume not expected in this test')
        },
        streamTurn: async function* streamTurn() {
          yield {
            type: 'assistant.message.started',
            itemId: 'assistant-1',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
          yield {
            type: 'assistant.text.delta',
            itemId: 'assistant-1',
            delta: '即时落盘',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
          await turnBlocked
          yield {
            type: 'assistant.message.completed',
            itemId: 'assistant-1',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
        },
        cancelTurn: async () => {},
        lastUsage: null,
      }),
    })

    await chatEngine.createAndSend({
      agentId: 'profile-1',
      workspaceId: 'workspace-1',
      cwd: '/tmp/workspace',
      text: '现在就写',
      modelId: 'claude-4',
    })

    await vi.waitFor(() => {
      expect(state.backendTimelineEvents.some(event => event.eventType === 'assistant.text.delta')).toBe(true)
    })

    const assistantRow = state.messages.find(message => message.role === 'assistant')

    expect(assistantRow?.content).toContain('即时落盘')

    releaseTurn?.()
    await vi.waitFor(() => {
      expect(state.backendRuns[0]?.status).toBe('complete')
    })
  })

  it('does not append bundled workflow or skills catalog into non-ACP system prompts', async () => {
    state.agentProfiles = [{
      id: 'profile-1',
      name: 'OpenAI Profile',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: '{}',
      credentialRef: null,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    }]
    state.agents = [{
      id: 'agent-1',
      name: 'Planner',
      description: null,
      avatarUrl: null,
      avatarStyle: 'bottts-neutral',
      avatarSeed: 'planner',
      providerId: 'profile-1',
      modelId: null,
      thinkingEffort: 'auto',
      configJson: JSON.stringify({ systemPrompt: '只保留 agent prompt' }),
      enabled: true,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    }]

    mocks.readBundledResource.mockReturnValue('BUNDLED WORKFLOW')
    mocks.scanSkills.mockReturnValue([{ id: 'skill-1', label: 'Skill 1' }])
    mocks.buildSkillCatalog.mockReturnValue('\n\nSKILL CATALOG')

    const streamTurn = vi.fn(async function* streamTurn(..._args: any[]) {
      yield {
        type: 'assistant.message.started',
        itemId: 'assistant-1',
        source: {
          backend: 'openai-compatible' as const,
          eventType: 'response.output_text.delta',
          itemId: 'assistant-1',
        },
      }
      yield {
        type: 'assistant.text.delta',
        itemId: 'assistant-1',
        delta: 'ok',
        source: {
          backend: 'openai-compatible' as const,
          eventType: 'response.output_text.delta',
          itemId: 'assistant-1',
        },
      }
      yield {
        type: 'assistant.message.completed',
        itemId: 'assistant-1',
        source: {
          backend: 'openai-compatible' as const,
          eventType: 'response.completed',
          itemId: 'assistant-1',
        },
      }
    })

    mocks.getProviderCatalog.mockReturnValue({
      get: () => ({
        providerKind: 'openai-compatible' as const,
        probe: async () => ({ ok: true, label: 'OpenAI', version: '1.0.0', details: {}, errorText: null }),
        listModels: async () => [],
        startChatSession: async () => ({
          id: 'backend-session-1',
          chatSessionId: 'chat-ignored',
          agentProfileId: 'profile-1',
          providerKind: 'openai-compatible' as const,
          providerSessionId: 'backend-session-1',
          providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'gpt-5' } }),
        }),
        resumeChatSession: async () => {
          throw new Error('resume not expected in this test')
        },
        streamTurn,
        cancelTurn: async () => {},
        lastUsage: null,
      }),
    })

    await chatEngine.createAndSend({
      agentId: 'profile-1',
      workspaceId: 'workspace-1',
      cwd: '/tmp/workspace',
      text: '把 prompt 收干净',
      agentIdentityId: 'agent-1',
    })

    await vi.waitFor(() => {
      expect(state.backendRuns[0]?.status).toBe('complete')
    })

    expect(streamTurn).toHaveBeenCalledTimes(1)
    expect(streamTurn.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        systemPrompt: '只保留 agent prompt',
      }),
    )
  })

  it('only pushes session timeline events to windows that explicitly watch that session', async () => {
    state.sessions = [{
      id: 'chat-1',
      workspaceId: 'workspace-1',
      title: 'Existing chat',
      agentProfileId: 'profile-1',
      agentId: null,
      linkedIssueId: null,
      pinned: 0,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    }]

    controlPlane.service.attachBinding({
      chatSessionId: 'chat-1',
      agentProfileId: 'profile-1',
      providerKind: 'acp-chat',
      backendSessionId: 'backend-session-1',
      backendStateSnapshot: JSON.stringify({ models: { currentModelId: 'claude-4' } }),
      requestedModelId: 'claude-4',
    })

    mocks.getProviderCatalog.mockReturnValue({
      get: () => ({
        providerKind: 'acp-chat' as const,
        probe: async () => ({ ok: true, label: 'ACP', version: '1.0.0', details: {}, errorText: null }),
        listModels: async () => [],
        startChatSession: async () => {
          throw new Error('start not expected in this test')
        },
        resumeChatSession: async () => ({
          id: 'backend-session-1',
          chatSessionId: 'chat-1',
          agentProfileId: 'profile-1',
          providerKind: 'acp-chat' as const,
          providerSessionId: 'backend-session-1',
          providerStateSnapshot: JSON.stringify({ models: { currentModelId: 'claude-4' } }),
        }),
        streamTurn: async function* streamTurn() {
          yield {
            type: 'assistant.message.started',
            itemId: 'assistant-1',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
          yield {
            type: 'assistant.text.delta',
            itemId: 'assistant-1',
            delta: '仅发送给订阅窗口',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
          yield {
            type: 'assistant.message.completed',
            itemId: 'assistant-1',
            source: {
              backend: 'acp-chat' as const,
              eventType: 'agent_message_chunk',
              itemId: 'assistant-1',
            },
          }
        },
        cancelTurn: async () => {},
        lastUsage: null,
      }),
    })

    const watcher = createFakeWebContents()
    const bystander = createFakeWebContents()
    const engine = chatEngine
    engine.subscribe(watcher as never)
    engine.subscribe(bystander as never)
    ;(engine as { watchSession?: (webContents: unknown, chatSessionId: string) => void }).watchSession?.(watcher, 'chat-1')

    await engine.send('chat-1', '开始吧')
    await vi.waitFor(() => {
      expect(state.backendRuns[0]?.status).toBe('complete')
    })

    expect(watcher.send).not.toHaveBeenCalled()
    // The broadcast now goes through the mock broadcaster, not direct wc.send
    expect(mockBroadcaster.broadcastFiltered).toHaveBeenCalledWith(
      'chat:timeline-event',
      expect.objectContaining({ chatSessionId: 'chat-1' }),
      expect.any(Function),
    )
    // Verify the predicate accepts the watcher but not the bystander
    const lastCall = mockBroadcaster.broadcastFiltered.mock.calls.find(([topic]) => topic === 'chat:timeline-event')
    expect(lastCall).toBeDefined()
    const predicate = lastCall![2] as (wc: unknown) => boolean
    expect(predicate(watcher)).toBe(true)
    expect(predicate(bystander)).toBe(false)
  })
})
