// Input: Electron WebContents handles and chat session ids from IPC/watch callers
// Output: Chat session watch registry with ref-counted per-session subscriptions
// Position: Chat transport plumbing — owns renderer/session watch state outside ChatEngine

import type { WebContents } from 'electron'

export interface ChatSessionWatchRegistry {
  watchSession: (webContents: WebContents, chatSessionId: string) => void
  unwatchSession: (webContents: WebContents, chatSessionId: string) => void
  getSessionWatchers: () => Map<string, Map<WebContents, number>>
}

export function createChatSessionWatchRegistry(): ChatSessionWatchRegistry {
  const sessionWatchers = new Map<string, Map<WebContents, number>>()
  const attachedRenderers = new WeakSet<WebContents>()

  function detachRenderer(webContents: WebContents): void {
    for (const [chatSessionId, counts] of sessionWatchers.entries()) {
      counts.delete(webContents)
      if (counts.size === 0) {
        sessionWatchers.delete(chatSessionId)
      }
    }
  }

  function ensureRendererAttachment(webContents: WebContents): void {
    if (attachedRenderers.has(webContents)) {
      return
    }

    attachedRenderers.add(webContents)
    webContents.once('destroyed', () => {
      detachRenderer(webContents)
    })
  }

  return {
    watchSession(webContents, chatSessionId) {
      ensureRendererAttachment(webContents)
      const counts = sessionWatchers.get(chatSessionId) ?? new Map<WebContents, number>()
      counts.set(webContents, (counts.get(webContents) ?? 0) + 1)
      sessionWatchers.set(chatSessionId, counts)
    },

    unwatchSession(webContents, chatSessionId) {
      const counts = sessionWatchers.get(chatSessionId)
      if (!counts) {
        return
      }

      const current = counts.get(webContents) ?? 0
      if (current <= 1) {
        counts.delete(webContents)
      }
      else {
        counts.set(webContents, current - 1)
      }

      if (counts.size === 0) {
        sessionWatchers.delete(chatSessionId)
      }
    },

    getSessionWatchers() {
      return sessionWatchers
    },
  }
}

export const chatSessionWatchRegistry = createChatSessionWatchRegistry()
