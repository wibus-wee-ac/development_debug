// @vitest-environment jsdom
//
// Input: React Testing Library, mocked Jarvis layout dependencies, and AppFooter
// Output: Regression tests for AppFooter Jarvis session tab controls
// Position: Layout component test guarding footer session activation and close semantics

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppFooter } from './app-footer'

const mockedDeps = vi.hoisted(() => ({
  jarvisState: {
    sessions: [
      { id: 'jarvis-1', title: 'Plan review', createdAt: 1 },
    ],
    activeSessionId: null as string | null,
    setActiveSessionId: vi.fn(),
    removeSession: vi.fn(),
  },
  registerFooter: vi.fn(),
}))

vi.mock('~/components/layout/layout-geometry-context', () => ({
  useLayoutGeometry: () => ({
    registerFooter: mockedDeps.registerFooter,
  }),
}))

vi.mock('~/features/system-agent/jarvis-popover', () => ({
  JarvisPopover: ({ open }: { open: boolean }) => (
    <div data-testid="mock-jarvis-popover" data-open={String(open)} />
  ),
}))

vi.mock('~/features/system-agent/jarvis-ui-store', () => ({
  useJarvisUiStore: (selector: (state: typeof mockedDeps.jarvisState) => unknown) => selector(mockedDeps.jarvisState),
}))

vi.mock('~/hooks/use-shortcut', () => ({
  useShortcut: () => {},
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

describe('AppFooter', () => {
  beforeEach(() => {
    mockedDeps.jarvisState.sessions = [
      { id: 'jarvis-1', title: 'Plan review', createdAt: 1 },
    ]
    mockedDeps.jarvisState.activeSessionId = null
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('closes a Jarvis session through a named sibling button without activating it', () => {
    render(<AppFooter />)

    fireEvent.click(screen.getByRole('button', { name: 'Close Jarvis session Plan review' }))

    expect(mockedDeps.jarvisState.removeSession).toHaveBeenCalledWith('jarvis-1')
    expect(mockedDeps.jarvisState.setActiveSessionId).not.toHaveBeenCalledWith('jarvis-1')
  })

  it('keeps the Jarvis session tab activation separate from closing', () => {
    render(<AppFooter />)

    fireEvent.click(screen.getByRole('button', { name: 'Plan review' }))

    expect(mockedDeps.jarvisState.setActiveSessionId).toHaveBeenCalledWith('jarvis-1')
    expect(mockedDeps.jarvisState.removeSession).not.toHaveBeenCalled()
  })
})
