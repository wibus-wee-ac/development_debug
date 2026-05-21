// @vitest-environment jsdom
/* Verifies devtool window keyboard tab switching. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DevtoolPage } from './ipc-devtool-page'

const mockedDeps = vi.hoisted(() => ({
  loadObservability: vi.fn()
}))

vi.mock('./observability/use-observability-events', () => ({
  useObservabilityDevtoolStore: (selector: (state: { load: () => void }) => unknown) =>
    selector({
      load: mockedDeps.loadObservability
    })
}))

vi.mock('./observability/observability-events-table', () => ({
  ObservabilityEventsTable: () => <div>Observability events panel</div>
}))

vi.mock('./observability/observability-event-detail', () => ({
  ObservabilityEventDetail: () => <div>Observability detail panel</div>
}))

vi.mock('./health/health-panel', () => ({
  HealthPanel: () => <div>Server health panel</div>
}))

vi.mock('./memory/memory-panel', () => ({
  MemoryPanel: () => <div>Memory panel</div>
}))

vi.mock('./tabs/tabs-panel', () => ({
  TabsPanel: () => <div>Tabs panel</div>
}))

vi.mock('./plugins/plugins-panel', () => ({
  PluginsPanel: () => <div>Plugins panel</div>
}))

describe('DevtoolPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('switches tabs with command number shortcuts', () => {
    render(<DevtoolPage />)

    expect(screen.getByText('Observability events panel')).toBeTruthy()

    fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true })
    expect(screen.getByText('Server health panel')).toBeTruthy()

    fireEvent.keyDown(window, { key: '5', code: 'Digit5', metaKey: true })
    expect(screen.getByText('Plugins panel')).toBeTruthy()
  })

  it('switches tabs with control number shortcuts and ignores shifted shortcuts', () => {
    render(<DevtoolPage />)

    fireEvent.keyDown(window, { key: '3', code: 'Digit3', ctrlKey: true })
    expect(screen.getByText('Memory panel')).toBeTruthy()

    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ctrlKey: true, shiftKey: true })
    expect(screen.getByText('Memory panel')).toBeTruthy()

    fireEvent.keyDown(window, { key: '4', code: 'Digit4', ctrlKey: true })
    expect(screen.getByText('Tabs panel')).toBeTruthy()
  })
})
