// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentActivity } from '~/lib/types'
import { AgentActivityItem } from './agent-activity-item'

function activity(partial: Partial<AgentActivity>): AgentActivity {
  return {
    id: 'activity-1',
    agentSessionId: 'agent-session-1',
    type: 'action',
    content: 'Run focused tests',
    signal: null,
    signalMetadata: null,
    createdAt: 1,
    ...partial,
  }
}

describe('AgentActivityItem', () => {
  afterEach(() => {
    cleanup()
  })

  it('marks the action type icon as decorative', () => {
    const { container } = render(
      <AgentActivityItem
        activity={activity({
          content: 'pnpm --filter @cradle/web test',
          type: 'action',
        })}
      />,
    )

    expect(screen.getByText('pnpm --filter @cradle/web test')).toBeTruthy()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('renders select elicitation options from valid metadata', () => {
    render(
      <AgentActivityItem
        activity={activity({
          content: 'Choose the next node',
          signal: 'select',
          signalMetadata: JSON.stringify({ options: ['UX', 'DX'] }),
          type: 'elicitation',
        })}
      />,
    )

    expect(screen.getByText('Choose the next node')).toBeTruthy()
    expect(screen.getByText('UX')).toBeTruthy()
    expect(screen.getByText('DX')).toBeTruthy()
  })
})
