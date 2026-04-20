// Input: ChatEngine, mocked DB access, mocked AcpConnectionManager singleton
// Output: Regression tests for ensureLive ACP session recovery behavior
// Position: Unit test file for src/main/lib/chat-engine.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tableRefs = vi.hoisted(() => ({
  workspaceTable: { kind: 'workspaces' },
  sessionTable: { kind: 'sessions' },
  messageTable: { kind: 'messages' },
}))

const dbState = vi.hoisted(() => ({
  sessionRow: null as null | {
    id: string
    workspaceId: string
    title: string
    agent: string
    recoverableAcpSessionId: string | null
    modelId: string | null
    configSnapshot: string | null
    createdAt?: number
    updatedAt?: number
  },
  workspaceRow: null as null | {
    id: string
    name: string
    path: string
    createdAt?: number
    updatedAt?: number
  },
  lastSessionPatch: null as null | Record<string, unknown>,
}))

const mockConnectionManager = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  isConnected: vi.fn(),
  connect: vi.fn(),
  supportsResumeSession: vi.fn(),
  supportsLoadSession: vi.fn(),
  resumeSession: vi.fn(),
  loadSession: vi.fn(),
  newSession: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionConfigOption: vi.fn(),
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true },
}))

vi.mock('../../db/schema', () => ({
  workspaces: tableRefs.workspaceTable,
  sessions: tableRefs.sessionTable,
  messages: tableRefs.messageTable,
}))

vi.mock('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          get: () => {
            if (table === tableRefs.workspaceTable) {
              return dbState.workspaceRow
            }
            if (table === tableRefs.sessionTable) {
              return dbState.sessionRow
            }
            return undefined
          },
          all: () => [],
          run: vi.fn(),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          run: () => {
            if (table === tableRefs.sessionTable && dbState.sessionRow) {
              dbState.sessionRow = {
                ...dbState.sessionRow,
                ...patch,
              }
              dbState.lastSessionPatch = patch
            }
          },
        }),
      }),
    }),
  }),
}))

vi.mock('../acp-connection', () => ({
  AcpConnectionManager: {
    getInstance: () => mockConnectionManager,
  },
}))

import { ChatEngine } from '../chat-engine'

describe('chatEngine ensureLive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.workspaceRow = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/tmp/workspace',
    }
    dbState.sessionRow = {
      id: 'chat-1',
      workspaceId: 'workspace-1',
      title: 'Session',
      agent: 'test-agent',
      recoverableAcpSessionId: 'acp-1',
      modelId: 'claude-3.7',
      configSnapshot: '[{\"id\":\"thought-level\",\"currentValue\":\"medium\"}]',
    }
    dbState.lastSessionPatch = null

    mockConnectionManager.isConnected.mockReturnValue(true)
    mockConnectionManager.getSessionState.mockReturnValue(null)
    mockConnectionManager.supportsResumeSession.mockReturnValue(true)
    mockConnectionManager.supportsLoadSession.mockReturnValue(true)
    mockConnectionManager.resumeSession.mockResolvedValue({
      models: {
        currentModelId: 'claude-4',
        availableModels: [{ modelId: 'claude-4', name: 'Claude 4' }],
      },
      configOptions: [
        {
          id: 'thought-level',
          name: 'Thinking effort',
          description: 'Reasoning depth',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [
            { value: 'medium', name: 'Medium' },
            { value: 'high', name: 'High' },
          ],
        },
      ],
    })
    mockConnectionManager.loadSession.mockResolvedValue({
      models: {
        currentModelId: 'claude-4',
        availableModels: [{ modelId: 'claude-4', name: 'Claude 4' }],
      },
      configOptions: [],
    })
    mockConnectionManager.newSession.mockResolvedValue({
      sessionId: 'acp-2',
      models: {
        currentModelId: 'claude-4',
        availableModels: [{ modelId: 'claude-4', name: 'Claude 4' }],
      },
      configOptions: [],
    })

    // @ts-expect-error test reset for singleton
    ChatEngine.instance = undefined
  })

  afterEach(() => {
    ChatEngine.getInstance().destroy()
  })

  it('resumes the stored ACP session before creating a new one', async () => {
    const result = await ChatEngine.getInstance().ensureLive('chat-1')

    expect(mockConnectionManager.resumeSession).toHaveBeenCalledWith(
      'test-agent',
      'acp-1',
      '/tmp/workspace',
    )
    expect(mockConnectionManager.loadSession).not.toHaveBeenCalled()
    expect(mockConnectionManager.newSession).not.toHaveBeenCalled()
    expect(result).toEqual({
      liveAcpSessionId: 'acp-1',
      continuity: 'resumed',
    })
    expect(dbState.lastSessionPatch).toEqual(
      expect.objectContaining({
        recoverableAcpSessionId: 'acp-1',
      }),
    )
  })

  it('falls back to a fresh ACP session when restore is unavailable', async () => {
    mockConnectionManager.resumeSession.mockRejectedValueOnce(new Error('unsupported'))
    mockConnectionManager.loadSession.mockRejectedValueOnce(new Error('unsupported'))

    const result = await ChatEngine.getInstance().ensureLive('chat-1')

    expect(mockConnectionManager.newSession).toHaveBeenCalledWith('test-agent', '/tmp/workspace')
    expect(result).toEqual({
      liveAcpSessionId: 'acp-2',
      continuity: 'reset',
    })
  })
})
