// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TabBar } from '../components/tab-bar'
import { TabsProvider } from '../provider'
import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

const dndMockState = vi.hoisted(() => ({
  activeId: 'mock-tab',
}))

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children, onDragStart, onDragMove, onDragEnd, onDragCancel }: {
    children: ReactNode
    onDragStart?: (event: { active: { id: string }, activatorEvent: Event }) => void
    onDragMove?: (event: { active: { id: string } }) => void
    onDragEnd?: (event: { active: { id: string }, over: null }) => void
    onDragCancel?: (event: { active: { id: string } }) => void
  }) => (
    <div>
      <button
        type="button"
        data-testid="mock-drag-start"
        onClick={() => {
          onDragStart?.({
            active: { id: dndMockState.activeId },
            activatorEvent: new MouseEvent('pointerdown', { screenX: 10, screenY: 10 }),
          })
        }}
      >
        Start drag
      </button>
      <button
        type="button"
        data-testid="mock-drag-move"
        onClick={() => {
          onDragMove?.({
            active: { id: dndMockState.activeId },
          })
        }}
      >
        Move drag
      </button>
      <button
        type="button"
        data-testid="mock-drag-end"
        onClick={() => {
          onDragEnd?.({
            active: { id: dndMockState.activeId },
            over: null,
          })
        }}
      >
        End drag
      </button>
      <button
        type="button"
        data-testid="mock-drag-cancel"
        onClick={() => {
          onDragCancel?.({
            active: { id: dndMockState.activeId },
          })
        }}
      >
        Cancel drag
      </button>
      {children}
    </div>
  ),
  DragOverlay: ({ children }: { children?: ReactNode, dropAnimation?: unknown }) => <>{children}</>,
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
  const tabId = store.getState().openTab('chat', { sessionId: 'one' })
  dndMockState.activeId = tabId
  const view = render(
    <TabsProvider store={store} registry={registry}>
      <TabBar onNewTab={vi.fn()} />
    </TabsProvider>,
  )
  return { store, ...view }
}

function renderTabBarWithTearOff(onTabTearOff = vi.fn()) {
  const store = createTabStore(registry, { persistKey: `tabs-next-tab-bar-tear-off-test-${Math.random()}` })
  const tabId = store.getState().openTab('chat', { sessionId: 'one' })
  dndMockState.activeId = tabId
  const view = render(
    <TabsProvider store={store} registry={registry}>
      <TabBar onTabTearOff={onTabTearOff} />
    </TabsProvider>,
  )
  return { onTabTearOff, store, tabId, ...view }
}

describe('tabBar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes labels for close and new-tab controls', () => {
    renderTabBar()

    expect(screen.getByRole('button', { name: 'Close Chat one' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New tab' })).toBeTruthy()
  })

  it('accepts a single customization object for tab chrome slots', () => {
    const store = createTabStore(registry, { persistKey: `tabs-next-tab-bar-customization-test-${Math.random()}` })
    store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabBar
          onNewTab={vi.fn()}
          customization={{
            closeIcon: <span data-testid="custom-close-icon">close</span>,
            newTabIcon: <span data-testid="custom-new-icon">new</span>,
            tabIcon: () => <span data-testid="custom-tab-icon">tab</span>,
          }}
        />
      </TabsProvider>,
    )

    expect(screen.getByTestId('custom-close-icon')).toBeTruthy()
    expect(screen.getByTestId('custom-new-icon')).toBeTruthy()
    expect(screen.getByTestId('custom-tab-icon')).toBeTruthy()
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

  it('tears off a tab only when the outside drag is released', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const { onTabTearOff, store, tabId } = renderTabBarWithTearOff()

    Object.defineProperties(window, {
      screenX: { configurable: true, value: 0 },
      screenY: { configurable: true, value: 0 },
      outerWidth: { configurable: true, value: 100 },
      outerHeight: { configurable: true, value: 100 },
    })

    fireEvent.click(screen.getByTestId('mock-drag-start'))
    const mouseMoveListener = addListener.mock.calls.find(call => call[0] === 'mousemove')?.[1]

    expect(mouseMoveListener).toBeTypeOf('function')

    ;(mouseMoveListener as EventListener)(new MouseEvent('mousemove', { screenX: 140, screenY: 20 }))

    expect(onTabTearOff).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('mock-drag-end'))

    expect(onTabTearOff).toHaveBeenCalledWith(store.getState().tabs.find(tab => tab.id === tabId), 140, 20)
  })

  it('does not tear off a tab when the drag is canceled outside the window', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const { onTabTearOff } = renderTabBarWithTearOff()

    Object.defineProperties(window, {
      screenX: { configurable: true, value: 0 },
      screenY: { configurable: true, value: 0 },
      outerWidth: { configurable: true, value: 100 },
      outerHeight: { configurable: true, value: 100 },
    })

    fireEvent.click(screen.getByTestId('mock-drag-start'))
    const mouseMoveListener = addListener.mock.calls.find(call => call[0] === 'mousemove')?.[1]

    expect(mouseMoveListener).toBeTypeOf('function')

    ;(mouseMoveListener as EventListener)(new MouseEvent('mousemove', { screenX: 140, screenY: 20 }))
    fireEvent.click(screen.getByTestId('mock-drag-cancel'))

    expect(onTabTearOff).not.toHaveBeenCalled()
  })
})
