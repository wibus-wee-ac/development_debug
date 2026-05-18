// @vitest-environment jsdom
//
// Input: React Testing Library, tabs-next provider, mocked dnd-kit boundary
// Output: regression coverage for TabBar accessibility and listener cleanup
// Position: Component-level tests for @cradle/tabs-next chrome controls

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabBar } from '../components/tab-bar'
import { TabsProvider } from '../provider'
import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children, onDragStart }: {
    children: ReactNode
    onDragStart?: (event: { activatorEvent: Event }) => void
  }) => (
    <div>
      <button
        type="button"
        data-testid="mock-drag-start"
        onClick={() => {
          onDragStart?.({
            activatorEvent: new MouseEvent('pointerdown', { screenX: 10, screenY: 10 }),
          })
        }}
      >
        Start drag
      </button>
      {children}
    </div>
  ),
  MouseSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}))

vi.mock('@dnd-kit/sortable', () => ({
  horizontalListSortingStrategy: vi.fn(),
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

function DummyComponent() {
  return null
}

const registry = {
  chat: defineTab({
    type: 'chat' as const,
    label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
    component: DummyComponent,
  }),
}

function renderTabBar() {
  const store = createTabStore(registry, { persistKey: `tabs-next-tab-bar-test-${Math.random()}` })
  store.getState().openTab('chat', { sessionId: 'one' })
  const view = render(
    <TabsProvider store={store} registry={registry}>
      <TabBar onNewTab={vi.fn()} />
    </TabsProvider>,
  )
  return { store, ...view }
}

describe('TabBar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes labels for close and new-tab controls', () => {
    renderTabBar()

    expect(screen.getByRole('button', { name: 'Close Chat one' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New tab' })).toBeTruthy()
  })

  it('removes the global drag listener when unmounted during a drag', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderTabBar()

    fireEvent.click(screen.getByTestId('mock-drag-start'))
    const pointerMoveListener = addListener.mock.calls.find(call => call[0] === 'pointermove')?.[1]

    expect(pointerMoveListener).toBeTypeOf('function')

    unmount()

    expect(removeListener).toHaveBeenCalledWith('pointermove', pointerMoveListener, true)
  })
})
