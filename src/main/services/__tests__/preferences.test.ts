// Input: vi mocks for appStore persistence and PreferencesService methods
// Output: Unit tests for global chat preference IPC behavior
// Position: Unit test file for src/main/services/preferences.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreferencesService } from '../preferences'

const mockGetChatPreferences = vi.fn()
const mockSetChatPreferences = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

vi.mock('../../store/app', () => ({
  getChatPreferences: (...args: unknown[]) => mockGetChatPreferences(...args),
  setChatPreferences: (...args: unknown[]) => mockSetChatPreferences(...args)
}))

vi.mock('node:async_hooks', () => ({
  AsyncLocalStorage: class {
    getStore = vi.fn()
    run = vi.fn()
  }
}))

describe('preferencesService', () => {
  let service: PreferencesService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PreferencesService()
  })

  it('returns global chat preferences', () => {
    mockGetChatPreferences.mockReturnValueOnce({
      modelId: 'claude-4',
      configSelections: { 'thought-level': 'high' }
    })

    expect(service.getChatPreferences()).toEqual({
      modelId: 'claude-4',
      configSelections: { 'thought-level': 'high' }
    })
  })

  it('persists global chat preferences', () => {
    const input = {
      modelId: 'gpt-5',
      configSelections: { 'thought-level': 'medium' }
    }

    service.setChatPreferences(input)

    expect(mockSetChatPreferences).toHaveBeenCalledWith(input)
  })
})
