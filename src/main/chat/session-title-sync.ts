// Input: ACP session title updates, backend control-plane bindings, and SignalBroadcaster
// Output: Disposable bridge that syncs provider-reported titles into chat sessions and renderer signals
// Position: Chat/ACP integration adapter wired in the composition root, outside ChatEngine

import { eq } from 'drizzle-orm'

import { acpConnectionManager } from '../acp/acp-connection'
import { getBackendControlPlaneService } from '../backend-control-plane/backend-control-plane'
import { getDb } from '../db'
import { sessions } from '../db/schema'
import type { SignalBroadcaster } from '../signal/broadcaster'

export interface ChatSessionTitleSyncDeps {
  broadcaster: SignalBroadcaster
}

export function createChatSessionTitleSync(deps: ChatSessionTitleSyncDeps): () => void {
  return acpConnectionManager.onSessionTitle((acpSessionId, title) => {
    const db = getDb()
    const seenChatSessions = new Set<string>()
    const bindings = getBackendControlPlaneService().listBindingsByBackendSessionId(acpSessionId)

    for (const binding of bindings) {
      if (seenChatSessions.has(binding.chatSessionId)) {
        continue
      }
      seenChatSessions.add(binding.chatSessionId)

      const row = db.select().from(sessions).where(eq(sessions.id, binding.chatSessionId)).get()
      if (!row) {
        continue
      }

      db.update(sessions)
        .set({ title, updatedAt: nowUnix() })
        .where(eq(sessions.id, row.id))
        .run()

      deps.broadcaster.broadcastGlobal('chat:session-title', {
        chatSessionId: row.id,
        title,
      })
    }
  })
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
