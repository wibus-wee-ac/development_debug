// Output: Guards tabs-next renderer retention from tearing down inactive tab effects.
// Input: TabRenderer with activity-pool policy and tab store activation changes.
// Position: Runtime lifecycle regression coverage for retained tab frames.
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

  it('keeps retained activity-pool tabs mounted when switching active tabs', () => {
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
        <TabRenderer policy={{ strategy: 'activity-pool', maxMountedTabs: 5, keepPinnedMounted: true }} />
      </TabsProvider>,
    )

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(1)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
    expect(screen.getByTestId(`tab-content-${homeId}`).className).toBe('w-full')
    expect(screen.getByTestId(`tab-content-${chatId}`).className).toBe('w-full')
    expect(screen.getByTestId(`tab-content-${homeId}`).hidden).toBe(true)
    expect(screen.getByTestId(`tab-content-${chatId}`).hidden).toBe(false)

    act(() => {
      store.getState().setActiveTab(homeId)
    })

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(1)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
    expect(screen.getByTestId(`tab-content-${homeId}`).hidden).toBe(false)
    expect(screen.getByTestId(`tab-content-${chatId}`).hidden).toBe(true)

    cleanup()

    expect(countEvent(events, 'home:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'home:effect-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:effect-cleanup')).toBe(1)
  })

  it('keeps default non-pinned retained tabs mounted across repeated switches', () => {
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
        <TabRenderer policy={{ strategy: 'activity-pool', maxMountedTabs: 5, keepPinnedMounted: true }} />
      </TabsProvider>,
    )

    expectMountedOnce(events, 'workspace')
    expectMountedOnce(events, 'chat')
    expectNoCleanup(events)

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })
    act(() => {
      store.getState().setActiveTab(chatId)
    })
    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expectMountedOnce(events, 'workspace')
    expectMountedOnce(events, 'chat')
    expectNoCleanup(events)
    expect(screen.getByTestId(`tab-content-${workspaceId}`).hidden).toBe(false)
    expect(screen.getByTestId(`tab-content-${chatId}`).hidden).toBe(true)
  })
})

function countEvent(events: string[], target: string): number {
  return events.filter(event => event === target).length
}

function expectMountedOnce(events: string[], label: string): void {
  expect(countEvent(events, `${label}:layout-mount`)).toBe(1)
  expect(countEvent(events, `${label}:effect-mount`)).toBe(1)
}

function expectNoCleanup(events: string[]): void {
  expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
}
