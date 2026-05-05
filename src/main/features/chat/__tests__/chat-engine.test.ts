// Input: ChatEngine, mocked provider catalog, mocked backend control plane, and in-memory DB fakes
// Output: Integration-style regression test for ChatEngine binding/run orchestration
// Position: Chat feature regression guard for control-plane-backed turn lifecycle

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../../db/schema'
import { ChatEngine } from '../chat-engine'

type FakeDbState = {
  agentProfiles: Array<typeof schema.agentProfiles.$inferSelect>
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
  configSnapshot: string | null
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

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getProviderCatalog: vi.fn(),
  getBackendControlPlaneService: vi.fn(),
  recordAgentContext: vi.fn(),
  indexMessage: vi.fn(),
  observePush: vi.fn(),
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
  readBundledResource: () => null,
}))

vi.mock('../../skills/skills', () => ({
  scanSkills: () => [],
  buildSkillCatalog: () => '',
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
    }
  }

  const selectRows = (table: unknown) => {
    if (table === schema.agentProfiles) {
      return state.agentProfiles
    }
    if (table === schema.sessions) {
      return state.sessions
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
          return {
            where() {
              return this
            },
            orderBy() {
              return this
            },
            get() {
              if (selection && table === schema.messages) {
                const first = rows[0] as typeof schema.messages.$inferSelect | undefined
                return first ? { sessionId: first.sessionId } : undefined
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

function createControlPlaneHarness() {
  const bindings = new Map<string, BindingRecord>()
  const runs = new Map<string, RunRecord>()
  const snapshots: Array<{ agentProfileId: string, providerKind: string, source: string, capabilitiesJson: string }> = []
  let resolveFinished: (() => void) | null = null
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })

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
      resolveFinished?.()
      return finished
    },
    recordCapabilitySnapshot(input: { agentProfileId: string, providerKind: string, source: string, capabilitiesJson: string }) {
      snapshots.push(input)
      return { id: `snapshot-${snapshots.length}`, ...input, recordedAt: 1_700_000_000 }
    },
  }

  return { service, bindings, runs, snapshots, finished }
}

describe('chatEngine', () => {
  let state: FakeDbState
  let controlPlane: ReturnType<typeof createControlPlaneHarness>

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
    controlPlane = createControlPlaneHarness()

    mocks.getDb.mockReturnValue(createFakeDb(state))
    mocks.getBackendControlPlaneService.mockReturnValue(controlPlane.service)
    mocks.recordAgentContext.mockReset()
    mocks.indexMessage.mockReset()
    mocks.observePush.mockReset()
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
            type: 'response.completed',
            sequence_number: 1,
            response: {},
          }
        },
        cancelTurn: async () => {},
        lastUsage: null,
      }),
    })
  })

  afterEach(() => {
    ChatEngine.getInstance().destroy()
    vi.clearAllMocks()
  })

  it('creates a binding and completes a backend run for one prompt', async () => {
    const sessionId = await ChatEngine.getInstance().createAndSend({
      agentId: 'profile-1',
      workspaceId: 'workspace-1',
      cwd: '/tmp/workspace',
      text: '你好，世界',
      modelId: 'claude-4',
    })

    await controlPlane.finished

    const binding = controlPlane.bindings.get(sessionId)
    const run = [...controlPlane.runs.values()][0]

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
    expect(state.sessions[0]?.id).toBe(sessionId)
    expect(state.messages).toHaveLength(2)
  })
})
