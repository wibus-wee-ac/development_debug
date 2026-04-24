// Input: vi mocks for database calls and SessionService methods
// Output: Unit tests for session metadata persistence updates and provider handle storage
// Position: Unit test file for src/main/services/session.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionService } from '../session'

const mockReturningGet = vi.fn()
const mockInsertValues = vi.fn(() => ({ returning: vi.fn(() => ({ get: mockReturningGet })) }))
const mockInsert = vi.fn(() => ({ values: mockInsertValues }))
const mockRun = vi.fn()
const mockWhere = vi.fn(() => ({ run: mockRun }))
const mockSet = vi.fn(() => ({ where: mockWhere }))
const mockUpdate = vi.fn(() => ({ set: mockSet }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
  },
}))

vi.mock('node:async_hooks', () => ({
  AsyncLocalStorage: class {
    getStore = vi.fn()
    run = vi.fn()
  },
}))

vi.mock('../../db', () => ({
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
  }),
}))

describe('sessionService', () => {
  let service: SessionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SessionService()
  })

  it('stores the provider session handle on create', () => {
    mockReturningGet.mockReturnValueOnce({
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Chat',
      agentProfileId: 'test-agent',
      providerKind: 'acp-chat',
      providerSessionId: 'acp-1',
    })

    service.create({
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Chat',
      agentProfileId: 'test-agent',
      providerKind: 'acp-chat',
      providerSessionId: 'acp-1',
    })

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'acp-1',
      }),
    )
  })

  it('updates persisted model and config snapshot for a session', () => {
    service.updateConfig({
      id: 'session-1',
      modelId: 'claude-4',
      configSnapshot: '[{"id":"thought-level","currentValue":"high"}]',
    })

    expect(mockUpdate).toHaveBeenCalled()
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'claude-4',
        configSnapshot: '[{"id":"thought-level","currentValue":"high"}]',
      }),
    )
    expect(mockRun).toHaveBeenCalled()
  })
})
