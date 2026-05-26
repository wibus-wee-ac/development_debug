// Output: Unit coverage for Chat-owned Jarvis attention context.
// Input: Chat attention snapshots and the shared Jarvis context registry.
// Position: Feature-owned tests for chat semantic context publication.

import { describe, expect, it } from 'vitest'

import { createContextRegistry } from '~/features/system-agent/context-registry'

import { clearChatAttentionSnapshot, createChatContextProvider, updateChatAttentionSnapshot } from './chat-context'

function readChatProviderItems(sessionId: string, now: number) {
  const registry = createContextRegistry({
    readActiveTab: () => ({ id: 'tab-1', type: 'chat', params: { sessionId } }),
    readNow: () => now,
    createEnvelopeId: timestamp => `ctx-${timestamp}`,
  })
  registry.registerProvider(createChatContextProvider())
  return registry.collectEnvelope()
}

describe('chat attention context', () => {
  it('records chat viewport and focus as a stable snapshot', () => {
    clearChatAttentionSnapshot('session-1')
    updateChatAttentionSnapshot('session-1', {
      messageCount: 42,
      firstVisibleIndex: 11,
      lastVisibleIndex: 17,
      scrollRatio: 0.37,
      isAtBottom: false,
      focusedArea: 'composer',
      updatedAt: 1779781200000,
    })

    const envelope = readChatProviderItems('session-1', 1779781200000)

    expect(envelope.activeTabParams.sessionId).toBe('session-1')
    expect(envelope.items).toEqual([
      expect.objectContaining({
        id: 'chat:attention:session-1',
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User manually scrolled away from the latest messages. Focused area: composer.',
        content: 'visible messages: 12-18 of 42; scroll progress: 37%',
        priority: 90,
        freshness: 'live',
        references: [{
          kind: 'chat-session',
          id: 'session-1',
          label: 'session-1',
        }],
      }),
    ])
  })
})
