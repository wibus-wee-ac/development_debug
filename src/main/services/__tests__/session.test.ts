// Input: vi mocks for database calls and SessionService methods
// Output: Unit tests for session metadata persistence updates
// Position: Unit test file for src/main/services/session.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionService } from '../session'

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
    update: mockUpdate,
  }),
}))

describe('sessionService', () => {
  let service: SessionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SessionService()
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
