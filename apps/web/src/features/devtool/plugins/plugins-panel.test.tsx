// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PluginsPanel } from './plugins-panel'

const mockedDeps = vi.hoisted(() => ({
  refresh: vi.fn(),
  executeGlobal: vi.fn(),
  executeOwned: vi.fn(),
}))

vi.mock('~/lib/plugin-store', () => ({
  usePluginStore: (selector: (state: {
    panels: Array<{ id: string; localId: string; title: string; owner: string }>
    commands: Array<{
      id: string
      localId: string
      title: string
      owner: string
      execute: () => void
    }>
  }) => unknown) => selector({
    panels: [],
    commands: [
      {
        id: 'demo:global',
        localId: 'global',
        title: 'Run Diagnostics',
        owner: 'demo',
        execute: mockedDeps.executeGlobal,
      },
      {
        id: 'sample:owned',
        localId: 'owned',
        title: 'Open Inspector',
        owner: 'sample',
        execute: mockedDeps.executeOwned,
      },
    ],
  }),
}))

vi.mock('./plugin-graph', () => ({
  PluginGraph: () => <div data-testid="plugin-graph" />,
}))

vi.mock('./use-plugin-data', () => ({
  usePluginData: () => ({
    plugins: [
      {
        identity: 'sample',
        name: 'sample',
        version: '1.0.0',
        displayName: 'Sample Plugin',
        description: 'Sample plugin',
        hasServer: false,
        hasWeb: true,
        hasDesktop: false,
        layers: {
          web: { status: 'active' },
        },
      },
    ],
    loading: false,
    error: null,
    refresh: mockedDeps.refresh,
    getActivatedAt: () => 1,
  }),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined | Record<string, boolean>>) => values
    .flatMap(value => {
      if (!value) return []
      if (typeof value === 'string') return [value]
      return Object.entries(value).filter(([, enabled]) => enabled).map(([key]) => key)
    })
    .join(' '),
}))

describe('PluginsPanel', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes registered command execution buttons by command name', () => {
    render(<PluginsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Execute Run Diagnostics' }))
    fireEvent.click(screen.getByRole('button', { name: /Sample Plugin/ }))

    const ownedCommandButtons = screen.getAllByRole('button', { name: 'Execute Open Inspector' })
    expect(ownedCommandButtons).toHaveLength(2)
    fireEvent.click(ownedCommandButtons[0])
    fireEvent.click(ownedCommandButtons[1])

    expect(mockedDeps.executeGlobal).toHaveBeenCalledTimes(1)
    expect(mockedDeps.executeOwned).toHaveBeenCalledTimes(2)
  })
})
