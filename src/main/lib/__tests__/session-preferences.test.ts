// Input: chat preference helpers and ACP session-shaped fixtures
// Output: Regression tests for model/thinking global chat preference behavior
// Position: Main Vitest suite covering shared chat preference application rules

import { describe, expect, it, vi } from 'vitest'

import {
  applyStoredChatPreferences,
  buildStoredChatPreferences,
} from '../../../shared/chat-preferences'
import type { AcpSessionState } from '../../lib/acp-connection'

describe('chat preferences', () => {
  it('captures current model and config selections from session state', () => {
    const state: AcpSessionState = {
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
            { value: 'low', name: 'Low' },
            { value: 'high', name: 'High' },
          ],
        },
      ],
    }

    expect(buildStoredChatPreferences(state)).toEqual({
      modelId: 'claude-4',
      configSelections: {
        'thought-level': 'high',
      },
    })
  })

  it('reapplies stored model and thinking selection to a fresh session', async () => {
    const setModel = vi.fn<(_modelId: string) => Promise<void>>().mockResolvedValue(undefined)
    const setConfigOption = vi
      .fn<(_configId: string, _value: string | boolean) => Promise<void>>()
      .mockResolvedValue(undefined)

    await applyStoredChatPreferences({
      preferences: {
        modelId: 'claude-4',
        configSelections: {
          'thought-level': 'high',
        },
      },
      state: {
        models: {
          currentModelId: 'claude-3.7',
          availableModels: [
            { modelId: 'claude-3.7', name: 'Claude 3.7' },
            { modelId: 'claude-4', name: 'Claude 4' },
          ],
        },
        configOptions: [
          {
            id: 'thought-level',
            name: 'Thinking effort',
            description: 'Reasoning depth',
            category: 'thought_level',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
      setModel,
      setConfigOption,
    })

    expect(setModel).toHaveBeenCalledWith('claude-4')
    expect(setConfigOption).toHaveBeenCalledWith('thought-level', 'high')
  })

  it('ignores unavailable stored values', async () => {
    const setModel = vi.fn<(_modelId: string) => Promise<void>>().mockResolvedValue(undefined)
    const setConfigOption = vi
      .fn<(_configId: string, _value: string | boolean) => Promise<void>>()
      .mockResolvedValue(undefined)

    await applyStoredChatPreferences({
      preferences: {
        modelId: 'claude-4',
        configSelections: {
          'thought-level': 'ultra',
        },
      },
      state: {
        models: {
          currentModelId: 'claude-3.7',
          availableModels: [{ modelId: 'claude-3.7', name: 'Claude 3.7' }],
        },
        configOptions: [
          {
            id: 'thought-level',
            name: 'Thinking effort',
            description: 'Reasoning depth',
            category: 'thought_level',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
      setModel,
      setConfigOption,
    })

    expect(setModel).not.toHaveBeenCalled()
    expect(setConfigOption).not.toHaveBeenCalled()
  })
})
