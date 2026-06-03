// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from '@testing-library/react'
import { lazy, useEffect, useLayoutEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { TabRenderer, useTabFrameActive } from '../components/tab-renderer'
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

function createRenderCountComponent(label: string, renderCounts: Map<string, number>) {
  return function RenderCountComponent() {
    renderCounts.set(label, (renderCounts.get(label) ?? 0) + 1)
    return <div>{label}</div>
  }
}

function createActiveSignalComponent(label: string, values: string[]) {
  return function ActiveSignalComponent() {
    const active = useTabFrameActive()
    values.push(`${label}:${active ? 'active' : 'inactive'}`)
    return <div>{label}</div>
  }
}

function createStressTabComponent(
  renderCounts: Map<string, number>,
  events: string[],
) {
  return function StressTabComponent({ params }: { params: { label: string } }) {
    const label = params.label
    renderCounts.set(label, (renderCounts.get(label) ?? 0) + 1)

    useLayoutEffect(() => {
      events.push(`${label}:layout-mount`)
      return () => {
        events.push(`${label}:layout-cleanup`)
      }
    }, [events, label])

    useEffect(() => {
      events.push(`${label}:effect-mount`)
      return () => {
        events.push(`${label}:effect-cleanup`)
      }
    }, [events, label])

    return <div>{`Content ${label}`}</div>
  }
}

function createDeferredTabComponent(label: string) {
  let resolveComponent: (value: { default: () => React.JSX.Element }) => void = () => {}
  const Component = lazy(() => new Promise<{ default: () => React.JSX.Element }>((resolve) => {
    resolveComponent = resolve
  }))

  return {
    Component,
    resolve: () => {
      resolveComponent({ default: () => <div>{label}</div> })
    },
  }
}

describe('tabRenderer lifecycle retention', () => {
  afterEach(() => {
    cleanup()
  })

  it('retains visited default tab trees without cleaning up effects during switches', async () => {
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
    await flushTabFrameReady()

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(1)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(events.some(event => event.endsWith(':layout-cleanup') || event.endsWith(':effect-cleanup'))).toBe(false)
    expectRetainedFrameVisibility(homeId, false)
    expectRetainedFrameVisibility(chatId, true)

    act(() => {
      store.getState().setActiveTab(homeId)
    })
    await flushTabFrameReady()

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:effect-mount')).toBe(1)
    expect(countEvent(events, 'chat:effect-mount')).toBe(1)
    expect(countEvent(events, 'home:layout-cleanup')).toBe(0)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(0)
    expect(countEvent(events, 'home:effect-cleanup')).toBe(0)
    expect(countEvent(events, 'chat:effect-cleanup')).toBe(0)
    expectRetainedFrameVisibility(homeId, true)
    expectRetainedFrameVisibility(chatId, false)

    act(() => {
      store.getState().setActiveTab(chatId)
    })
    await flushTabFrameReady()

    expect(countEvent(events, 'home:layout-mount')).toBe(1)
    expect(countEvent(events, 'chat:layout-mount')).toBe(1)
    expect(countEvent(events, 'home:layout-cleanup')).toBe(0)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(0)
    expectRetainedFrameVisibility(homeId, false)
    expectRetainedFrameVisibility(chatId, true)

    cleanup()

    expect(countEvent(events, 'home:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:layout-cleanup')).toBe(1)
    expect(countEvent(events, 'home:effect-cleanup')).toBe(1)
    expect(countEvent(events, 'chat:effect-cleanup')).toBe(1)
  })

  it('keeps default non-pinned tab frames retained across repeated switches', async () => {
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
    await flushTabFrameReady()

    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })
    expectNoCleanup(events)

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })
    await flushTabFrameReady()
    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })

    act(() => {
      store.getState().setActiveTab(chatId)
    })
    await flushTabFrameReady()
    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })
    await flushTabFrameReady()

    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })
    expectRetainedFrameVisibility(workspaceId, true)
    expectRetainedFrameVisibility(chatId, false)
  })

  it('does not rerender retained route content when only tab visibility changes', () => {
    const renderCounts = new Map<string, number>()
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        component: createRenderCountComponent('workspace', renderCounts),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: createRenderCountComponent('chat', renderCounts),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-render-count-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)

    act(() => {
      store.getState().setActiveTab(chatId)
    })

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)
  })

  it('keeps retained route content stable during high-frequency multi-tab switches', async () => {
    const renderCounts = new Map<string, number>()
    const events: string[] = []
    const registry = {
      stress: defineTab({
        type: 'stress' as const,
        label: (params: { label: string }) => `Stress ${params.label}`,
        component: createStressTabComponent(renderCounts, events),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-stress-switches-${Math.random()}` })
    const tabIds = Array.from({ length: 8 }, (_, index) => {
      return store.getState().createTab('stress', { label: `tab-${index}` })
    })
    const retainedContexts = store.getState().contexts

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer fallback={<div data-testid="tab-loading">Loading</div>} />
      </TabsProvider>,
    )
    await flushTabFrameReady()

    for (let index = 0; index < tabIds.length; index += 1) {
      const label = `tab-${index}`
      expect(renderCounts.get(label) ?? 0).toBe(1)
      expectEffectCounts(events, label, { mounts: 1, cleanups: 0 })
      expect(within(screen.getByTestId(`tab-content-${tabIds[index]}`)).getByText(`Content ${label}`)).toBeTruthy()
      expect(within(screen.getByTestId(`tab-content-${tabIds[index]}`)).queryByTestId('tab-loading')).toBeNull()
    }

    for (let index = 0; index < 240; index += 1) {
      act(() => {
        store.getState().setActiveTab(tabIds[index % tabIds.length])
      })
    }
    await flushTabFrameReady()

    for (let index = 0; index < tabIds.length; index += 1) {
      const label = `tab-${index}`
      const visible = tabIds[index] === store.getState().activeTabId
      expect(renderCounts.get(label) ?? 0).toBe(1)
      expectEffectCounts(events, label, { mounts: 1, cleanups: 0 })
      expect(store.getState().contexts).toBe(retainedContexts)
      expectRetainedFrameVisibility(tabIds[index], visible)
      expect(within(screen.getByTestId(`tab-content-${tabIds[index]}`)).getByText(`Content ${label}`)).toBeTruthy()
      expect(within(screen.getByTestId(`tab-content-${tabIds[index]}`)).queryByTestId('tab-loading')).toBeNull()
    }
  })

  it('exposes active frame state to retained content that explicitly consumes it', () => {
    const values: string[] = []
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        component: createActiveSignalComponent('workspace', values),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: createActiveSignalComponent('chat', values),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-active-signal-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )

    expect(values).toEqual(['workspace:inactive', 'chat:active'])

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expect(values).toEqual([
      'workspace:inactive',
      'chat:active',
      'workspace:active',
      'chat:inactive',
    ])

    act(() => {
      store.getState().setActiveTab(chatId)
    })

    expect(values).toEqual([
      'workspace:inactive',
      'chat:active',
      'workspace:active',
      'chat:inactive',
      'workspace:inactive',
      'chat:active',
    ])
  })

  it('keeps resolved Suspense content visible across tab switches without returning to fallback', async () => {
    const workspace = createDeferredTabComponent('Workspace content')
    const chat = createDeferredTabComponent('Chat content')
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        component: workspace.Component,
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: chat.Component,
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-suspense-retention-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer fallback={<div data-testid="tab-loading">Loading</div>} />
      </TabsProvider>,
    )

    expect(within(screen.getByTestId(`tab-content-${chatId}`)).getByTestId('tab-loading')).toBeTruthy()

    await act(async () => {
      workspace.resolve()
      chat.resolve()
    })

    expect(within(screen.getByTestId(`tab-content-${chatId}`)).getByText('Chat content')).toBeTruthy()
    expect(within(screen.getByTestId(`tab-content-${chatId}`)).queryByTestId('tab-loading')).toBeNull()

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })

    expect(within(screen.getByTestId(`tab-content-${workspaceId}`)).getByText('Workspace content')).toBeTruthy()
    expect(within(screen.getByTestId(`tab-content-${workspaceId}`)).queryByTestId('tab-loading')).toBeNull()

    act(() => {
      store.getState().setActiveTab(chatId)
    })

    expect(within(screen.getByTestId(`tab-content-${chatId}`)).getByText('Chat content')).toBeTruthy()
    expect(within(screen.getByTestId(`tab-content-${chatId}`)).queryByTestId('tab-loading')).toBeNull()
  })

  it('does not rerender route content in other tabs when one tab viewState is updated', () => {
    const renderCounts = new Map<string, number>()
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        component: createRenderCountComponent('workspace', renderCounts),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        component: createRenderCountComponent('chat', renderCounts),
      }),
      settings: defineTab({
        type: 'settings' as const,
        label: 'Settings',
        component: createRenderCountComponent('settings', renderCounts),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-viewstate-isolation-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    store.getState().openTab('chat', { sessionId: 'one' })
    store.getState().openTab('settings')

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)
    expect(renderCounts.get('settings') ?? 0).toBe(1)

    act(() => {
      store.getState().updateTabViewState(workspaceId, 'some-key', { x: 1 })
    })

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)
    expect(renderCounts.get('settings') ?? 0).toBe(1)

    act(() => {
      store.getState().updateTabViewState(workspaceId, 'some-key', { x: 2 })
      store.getState().updateTabViewState(workspaceId, 'some-key', { x: 3 })
    })

    expect(renderCounts.get('workspace') ?? 0).toBe(1)
    expect(renderCounts.get('chat') ?? 0).toBe(1)
    expect(renderCounts.get('settings') ?? 0).toBe(1)
  })

  it('keeps discardable tabs on Activity hidden semantics', async () => {
    const events: string[] = []
    const registry = {
      workspace: defineTab({
        type: 'workspace' as const,
        label: 'Workspace',
        keepAlive: 'discardable',
        component: createLifecycleComponent('workspace', events),
      }),
      chat: defineTab({
        type: 'chat' as const,
        label: (params: { sessionId: string }) => `Chat ${params.sessionId}`,
        keepAlive: 'discardable',
        component: createLifecycleComponent('chat', events),
      }),
    }
    const store = createTabStore(registry, { persistKey: `tabs-next-renderer-discardable-lifecycle-${Math.random()}` })
    const workspaceId = store.getState().openTab('workspace')
    const chatId = store.getState().openTab('chat', { sessionId: 'one' })

    render(
      <TabsProvider store={store} registry={registry}>
        <TabRenderer />
      </TabsProvider>,
    )
    await flushTabFrameReady()

    expectEffectCounts(events, 'workspace', { mounts: 0, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 0 })

    act(() => {
      store.getState().setActiveTab(workspaceId)
    })
    await flushTabFrameReady()

    expectEffectCounts(events, 'workspace', { mounts: 1, cleanups: 0 })
    expectEffectCounts(events, 'chat', { mounts: 1, cleanups: 1 })
    expectRetainedFrameVisibility(workspaceId, true)
    expectRetainedFrameVisibility(chatId, false)
  })
})

function expectRetainedFrameVisibility(tabId: string, visible: boolean): void {
  const frame = screen.getByTestId(`tab-content-${tabId}`)
  expect(frame.getAttribute('data-tab-visible')).toBe(visible ? 'true' : 'false')
  expect(frame.className).toContain('absolute')
  expect(frame.className).toContain('inset-0')
  expect(frame.className).toContain(visible ? 'visible' : 'invisible')
  expect(frame.className).toContain(visible ? 'pointer-events-auto' : 'pointer-events-none')
}

async function flushTabFrameReady(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

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
