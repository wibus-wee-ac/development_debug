// Output: Guards tabs-next Activity rendering from dropping inactive tab DOM frames.
// Input: TabRenderer with React Activity frames and tab store activation changes.
// Position: Runtime lifecycle regression coverage for Activity-backed tab frames.
// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect, useLayoutEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { TabRenderer } from '../components/tab-renderer'
import { TabsProvider } from '../provider'
import { defineTab } from '../route-definition'
import { createTabStore } from '../store'

function createLifecycleComponent(label: string, events: string[]) {
  return function LifecycleComponent() {
    useLayoutEffect(() => {
      events.push(`${label}:layout-mount`)
      return () => {
        events.push(`${label}:layout-cleanup`)
      }
    }, [events])

    useEffect(() => {
      events.push(`${label}:effect-mount`)
      return () => {
        events.push(`${label}:effect-cleanup`)
      }
    }, [events])

    return <div>{label}</div>
  }
}

describe('TabRenderer lifecycle retention', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps Activity tab frames in the DOM while hidden effects clean up', () => {
    const events: string[] = []
    const registry = {
      home: defineTab({
        type: 'home' as const,
        label: 'Home',
        pinned: true,
        component: createLifecycleComponent('home', events),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: createLifecycleComponent('chat', events),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-lifecycle-${Math.random()}` })
    const homeId = store.getState().openTab('home', {}, { pinned: true })
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )

    expect(countEvent(events, 'home:layout-mount')).toBe(0)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(0)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
    expect(screen.getByTestId(`tab-content-${homeId}`).className).toBe('w-full')
    expect(screen.getByTestId(`tab-content-${chatId}`).className).toBe('w-full')
    expect(screen.getByTestId(`tab-content-${homeId}`).getAttribute('data-tab-visible')).toBe('false')
    expect(screen.getByTestId(`tab-content-${chatId}`).getAttribute('data-tab-visible')).toBe('true')

    act(() => {
      store.getState().setActiveTab(homeId)
    })

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(1)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(countEvent(events, 'home:layout-cleanup')).toBe(0)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'home:effect-cleanup')).toBe(0)
    expect(countEvent(events, 'chat:effect-cleanup')).toBe(1)
    expect(screen.getByTestId(`tab-content-${homeId}`).getAttribute('data-tab-visible')).toBe('true')
    expect(screen.getByTestId(`tab-content-${chatId}`).getAttribute('data-tab-visible')).toBe('false')

    cleanup()

    expect(countEvent(events, 'home:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'home:effect-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:effect-cleanup')).toBe(1)
  })

  it('keeps default non-pinned tab frames retained across repeated switches', () => {
    const events: string[] = []
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        component: createLifecycleComponent('workspace', events),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: createLifecycleComponent('chat', events),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-default-lifecycle-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )

    expectEffectCounts(events, 'workspace', { mounts: 0, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })
    expectNoCleanup(events)

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })
    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 1 })

    act(() => {
      store.getState().setActiveTab(chatId)
    })
    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 1 })
    expectEffectCounts(events, 'chat', { mounts: 2, cleanups: 1 })

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expectEffectCounts(events, 'workspace', { mounts: 2, cleanups: 1 })
    expectEffectCounts(events, 'chat', { mounts: 2, cleanups: 2 })
    expect(screen.getByTestId(`tab-content-${workspaceId}`).getAttribute('data-tab-visible')).toBe('true')
    expect(screen.getByTestId(`tab-content-${chatId}`).getAttribute('data-tab-visible')).toBe('false')
  })
})

function countEvent(events: string[], target: string): number {
  return events.filter(event => event === target).length
}

function expectEffectCounts(
  events: string[],
  label: string,
  counts: { mounts: number, cleanups: number },
): void {
  expect(countEvent(events, `${label}:layout-mount`)).toBe(counts.mounts)
  expect(countEvent(events, `${label}:effect-mount`)).toBe(counts.mounts)
  expect(countEvent(events, `${label}:layout-cleanup`)).toBe(counts.cleanups)
  expect(countEvent(events, `${label}:effect-cleanup`)).toBe(counts.cleanups)
}

function expectNoCleanup(events: string[]): void {
  expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
}
