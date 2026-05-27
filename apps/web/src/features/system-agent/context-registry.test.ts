// Output: Unit coverage for Jarvis context registry and legacy snapshot projection.
// Input: Fake providers and SystemAgentContext fixtures.
// Position: Feature-owned tests for the system-agent semantic context aggregation boundary.

import { describe, expect, it } from 'vitest'

import { createContextRegistry } from './context-registry'
import type { SystemAgentContext } from './context-schema'
import { projectLegacyContextItems } from './legacy-context-items'

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

describe('legacy Jarvis context item projection', () => {
  it('represents existing snapshot fields as typed context items', () => {
    const legacy: SystemAgentContext = {
      activeTab: {
        type: 'chat',
        label: 'Architecture discussion',
        params: { sessionId: 'session-1' },
      },
      openTabs: [
        { type: 'home', label: 'Home' },
        { type: 'chat', label: 'Architecture discussion' },
      ],
      chatContext: {
        sessionId: 'session-1',
        status: 'idle',
        messageCount: 3,
        recentMessages: [
          { role: 'user', contentPreview: 'Can you inspect the context model?' },
          { role: 'assistant', contentPreview: 'The current model is too shallow.' },
        ],
      },
      layout: {
        sidebarCollapsed: true,
        asideOpen: true,
        asideActiveTab: 'browser',
        bottomPanelOpen: false,
        settingsTabId: null,
        settingsSection: 'general',
      },
      activeProfileId: 'profile-1',
      unreadSessionIds: ['session-2'],
    }

    const items = projectLegacyContextItems(legacy, 1779781200000)

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
