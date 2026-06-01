/**
 * Output: Regression coverage for slash command panel runtime state rendering.
 * Input: Provider-owned slash command descriptors with compact usage visuals.
 * Position: Chat feature tests for composer slash command presentation.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SlashCommandPanel } from './slash-command-panel'

describe('slash command panel', () => {
  it('renders compact provider usage state as a row icon ring', () => {
    render(
      <SlashCommandPanel
        commands={[
          {
            id: 'codex:compact',
            name: 'compact',
            label: 'Compact',
            description: 'Compact this conversation context.',
            argumentHint: '[instructions]',
            source: 'runtime',
            action: { kind: 'insertText', text: '/compact ' },
            presentation: 'slot',
            iconKey: 'compact',
            stateLabel: 'Used 52%',
            stateTone: 'neutral',
            stateVisual: {
              kind: 'compactUsage',
              percent: 52,
              status: 'idle',
            },
          },
        ]}
        query=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
        visible
      />,
    )

    expect(screen.getByTestId('slash-command-compact-state-ring')).toBeTruthy()
    expect(screen.getByText('Compact this conversation context. (used 52%)')).toBeTruthy()
    expect(screen.queryByTestId('slash-command-description')).toBeNull()
  })
})
