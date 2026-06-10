import { describe, expect, it } from 'vitest'

import { createContextRegistry } from '~/features/context/context-registry'
import { useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'
import { useNewChatStore } from '~/store/new-chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useSurfaceStore } from '~/navigation/surface-store'

import { readSystemAgentContextItems } from './system-context-provider'

describe('jarvis context registry', () => {
  it('collects provider items into a typed envelope with active surface metadata', () => {
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: 'chat:session-1', type: 'chat', params: { sessionId: 'session-1' }, search: {} }),
      readNow: () => 1779781200000,
      createEnvelopeId: now => `ctx-test-${now}`,
    })

    registry.registerProvider({
      owner: 'chat',
      readContext: input => [{
        id: `chat:attention:${input.activeSurfaceId}`,
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
      activeSurfaceId: 'chat:session-1',
      activeSurfaceType: 'chat',
      activeSurfaceParams: { sessionId: 'session-1' },
      activeSurfaceSearch: {},
      items: [{
        id: 'chat:attention:chat:session-1',
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
      readActiveSurface: () => ({ id: null, type: null }),
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
    useSurfaceStore.setState({
      activeSurfaceId: 'chat:session-1',
      surfaces: [
        { id: 'home', kind: 'home', title: 'Home', route: { to: '/' }, order: 0, closable: false },
        {
          id: 'chat:session-1',
          kind: 'chat',
          title: 'Architecture discussion',
          route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
          order: 1,
          closable: true,
        },
      ],
    })
    useChatStore.getState().setMessages('session-1', [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Can you inspect the context model?' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'The current model is too shallow.' }] },
    ])
    useLayoutStore.setState({ sidebarCollapsed: true, asideOpen: true, asideActiveTab: 'browser', bottomPanelOpen: false })
    useSettingsOverlayStore.setState({ settingsSection: 'general' })
    useNewChatStore.setState({ lastAgentProfileId: 'profile-1' })

    const items = readSystemAgentContextItems(1779781200000)

    expect(items.map(item => [item.kind, item.title, item.owner])).toEqual([
      ['view', 'Active view', 'system-agent'],
      ['view', 'Open surfaces', 'system-agent'],
      ['history', 'Active chat summary', 'system-agent'],
      ['layout', 'Layout', 'system-agent'],
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
