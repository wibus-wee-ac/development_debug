// Output: Unit coverage for Jarvis context registry and system-agent context provider projection.
// Input: Fake providers and renderer store fixtures.
// Position: Feature-owned tests for the system-agent semantic context aggregation boundary.

import { describe, expect, it } from 'vitest'

import { createContextRegistry } from '~/features/context/context-registry'
import { useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'
import { useSessionActivityStore } from '~/store/session-activity'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'
import { readSystemAgentContextItems } from './system-context-provider'

describe('jarvis context registry', () => {
  it('collects provider items into a typed envelope with active tab metadata', () => {
    const registry = createContextRegistry({
      readActiveTab: () => ({ id: 'tab-1', type: 'chat', params: { sessionId: 'session-1' } }),
      readNow: () => 1779781200000,
      createEnvelopeId: now => `ctx-test-${now}`,
    })

    registry.registerProvider({
      owner: 'chat',
      readContext: input => [{
        id: `chat:attention:${input.activeTabId}`,
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User is viewing historical messages.',
        priority: 90,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 8,
        createdAt: input.now,
      }],
    })

    expect(registry.collectEnvelope()).toEqual({
      id: 'ctx-test-1779781200000',
      capturedAt: 1779781200000,
      activeTabId: 'tab-1',
      activeTabType: 'chat',
      activeTabParams: { sessionId: 'session-1' },
      items: [{
        id: 'chat:attention:tab-1',
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User is viewing historical messages.',
        priority: 90,
        freshness: 'live',
        sensitivity: 'private',
        tokenEstimate: 8,
        createdAt: 1779781200000,
      }],
    })
  })

  it('rejects duplicate provider owners to preserve ownership boundaries', () => {
    const registry = createContextRegistry({
      readActiveTab: () => ({ id: null, type: null }),
    })
    const provider = {
      owner: 'chat',
      readContext: () => [],
    }

    registry.registerProvider(provider)

    expect(() => registry.registerProvider(provider)).toThrow('Context provider already registered: chat')
  })
})

describe('system-agent Jarvis context provider', () => {
  it('represents current shell stores as typed context items', () => {
    useCradleTabStore.setState({
      activeTabId: 'tab-chat',
      tabs: [
        { id: 'tab-home', type: 'home', label: 'Home', params: {}, pinned: false },
        { id: 'tab-chat', type: 'chat', label: 'Architecture discussion', params: { sessionId: 'session-1' }, pinned: false },
      ],
    })
    useChatStore.setState({
      sessions: {
        'session-1': {
          messages: [
            { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Can you inspect the context model?' }] },
            { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'The current model is too shallow.' }] },
          ],
          status: 'idle',
        },
      },
    } as Partial<ReturnType<typeof useChatStore.getState>>)
    useLayoutStore.setState({ sidebarCollapsed: true, asideOpen: true, asideActiveTab: 'browser', bottomPanelOpen: false })
    useSettingsOverlayStore.setState({ settingsTabId: null, settingsSection: 'general' })
    useNewChatStore.setState({ lastAgentProfileId: 'profile-1' })
    useSessionActivityStore.setState({ unread: new Set(['session-2']) })

    const items = readSystemAgentContextItems(1779781200000)

    expect(items.map(item => [item.kind, item.title, item.owner])).toEqual([
      ['view', 'Active view', 'system-agent'],
      ['view', 'Open tabs', 'system-agent'],
      ['history', 'Active chat summary', 'system-agent'],
      ['layout', 'Layout', 'system-agent'],
      ['attention', 'Unread sessions', 'system-agent'],
      ['entity', 'Active Jarvis profile', 'system-agent'],
    ])
    expect(items.find(item => item.title === 'Active chat summary')).toMatchObject({
      references: [{
        kind: 'chat-session',
        id: 'session-1',
        label: 'session-1',
      }],
      content: 'last message: [assistant] The current model is too shallow.',
    })
  })
})
