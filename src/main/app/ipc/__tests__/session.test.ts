// Input: vi mocks for database calls and SessionService methods
// Output: Unit tests for session metadata persistence on the thin session IPC surface
// Position: Unit test file for src/main/app/ipc/session.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionService } from '../session'

const mockReturningGet = vi.fn()
const mockInsertValues = vi.fn(() => ({ returning: vi.fn(() => ({ get: mockReturningGet })) }))
const mockInsert = vi.fn(() => ({ values: mockInsertValues }))
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

vi.mock('../../../db', () => ({
  getDb: () => ({
    insert: mockInsert,
  }),
}))

describe('sessionService', () => {
  let service: SessionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SessionService()
  })

  it('stores only product session metadata on create', () => {
    mockReturningGet.mockReturnValueOnce({
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Chat',
      agentProfileId: 'test-agent',
      agentId: null,
      linkedIssueId: null,
      pinned: 0,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    })

    service.create({
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Chat',
      agentProfileId: 'test-agent',
    })

    expect(mockInsertValues).toHaveBeenCalledWith({
      id: 'session-1',
      workspaceId: 'workspace-1',
      title: 'Chat',
      agentProfileId: 'test-agent',
    })
  })
})
