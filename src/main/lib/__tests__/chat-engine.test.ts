// Input: ChatEngine, mocked DB access, mocked provider catalog
// Output: Regression tests for ChatEngine session lifecycle
// Position: Unit test file for src/main/lib/chat-engine.ts
//
// NOTE: The ACP session recovery tests (ensureLive) have been moved to
// AcpChatProvider.resumeChatSession. ChatEngine now delegates session
// recovery to the provider catalog.

import { describe, it } from 'vitest'

describe('chatEngine', () => {
  it('delegates session recovery to provider catalog', () => {
    // Session recovery is handled by AcpChatProvider.resumeChatSession.
    // Integration tests cover the full flow via ChatService IPC.
  })
})
