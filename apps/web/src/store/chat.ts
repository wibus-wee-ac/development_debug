// Input: zustand, subscribeWithSelector, UIMessage/UIMessageChunk types
// Output: useChatStore — Zustand store managing per-session messages and per-message streaming state
// Position: Core data layer for chat feature, replaces @ai-sdk/react useChat state management

import type { UIMessage } from 'ai'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import { postChatSessionsBySessionIdCancel } from '~/api-gen'

// ── Types ───────────────────────────────────────────────────

export type PublicStatus = 'idle' | 'streaming' | 'error'

interface ChatError {
  message: string
  timestamp: number
}

interface SessionMeta {
  /** Passive observer status (for sessions streaming from another tab/reload) */
  passiveStatus: PublicStatus
  /** Whether this renderer locally initiated the current stream */
  locallyDriving: boolean
}

// ── State Interface ─────────────────────────────────────────

interface ChatState {
  // --- Message Data ---
  messagesMap: Map<string, UIMessage[]>

  // --- Streaming State ---
  generatingMessageIds: Set<string>
  activeAbortControllers: Map<string, AbortController>

  // --- Error State ---
  errorMap: Map<string, ChatError>

  // --- Session Meta ---
  sessionMetaMap: Map<string, SessionMeta>

  // --- Actions: Messages ---
  setMessages: (sessionId: string, messages: UIMessage[]) => void
  updateMessage: (sessionId: string, messageId: string, updater: (msg: UIMessage) => UIMessage) => void
  appendMessage: (sessionId: string, message: UIMessage) => void

  // --- Actions: Streaming ---
  startGeneration: (sessionId: string, messageId: string, controller: AbortController) => void
  finishGeneration: (messageId: string) => void
  failGeneration: (messageId: string, error: string) => void
  stopGeneration: (messageId: string, sessionId: string) => Promise<void>

  // --- Actions: Session Meta ---
  setSessionMeta: (sessionId: string, meta: Partial<SessionMeta>) => void
  setPassiveStatus: (sessionId: string, status: PublicStatus) => void

  // --- Actions: Cleanup ---
  clearSession: (sessionId: string) => void
  clearError: (messageId: string) => void
}

// ── Server Base ─────────────────────────────────────────────

type MessagePart = UIMessage['parts'][number]
const EMPTY_MESSAGES: UIMessage[] = []
const DEFAULT_SESSION_META: SessionMeta = { passiveStatus: 'idle', locallyDriving: false }

// ── Store ───────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(
  subscribeWithSelector(
    (set, get) => ({
      messagesMap: new Map(),
      generatingMessageIds: new Set(),
      activeAbortControllers: new Map(),
      errorMap: new Map(),
      sessionMetaMap: new Map(),

      // --- Messages ---

      setMessages: (sessionId, messages) => {
        set((state) => {
          const currentMessages = state.messagesMap.get(sessionId)
          const nextMessages = currentMessages
            ? reconcileMessages(currentMessages, messages)
            : messages

          if (currentMessages === nextMessages) {
            return state
          }

          const next = new Map(state.messagesMap)
          next.set(sessionId, nextMessages)
          return { messagesMap: next }
        })
      },

      updateMessage: (sessionId, messageId, updater) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages) {
            return state
          }

          const idx = messages.findIndex(m => m.id === messageId)
          if (idx === -1) {
            return state
          }

          const updated = [...messages]
          updated[idx] = updater(messages[idx])

          const next = new Map(state.messagesMap)
          next.set(sessionId, updated)
          return { messagesMap: next }
        })
      },

      appendMessage: (sessionId, message) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId) ?? []
          const next = new Map(state.messagesMap)
          next.set(sessionId, [...messages, message])
          return { messagesMap: next }
        })
      },

      // --- Streaming ---

      startGeneration: (sessionId, messageId, controller) => {
        set((state) => {
          const nextGen = new Set(state.generatingMessageIds)
          nextGen.add(messageId)
          const nextCtrl = new Map(state.activeAbortControllers)
          nextCtrl.set(messageId, controller)
          const nextMeta = new Map(state.sessionMetaMap)
          nextMeta.set(sessionId, {
            ...(state.sessionMetaMap.get(sessionId) ?? { passiveStatus: 'idle', locallyDriving: false }),
            locallyDriving: true,
          })
          return {
            generatingMessageIds: nextGen,
            activeAbortControllers: nextCtrl,
            sessionMetaMap: nextMeta,
          }
        })
      },

      finishGeneration: (messageId) => {
        set((state) => {
          const nextGen = new Set(state.generatingMessageIds)
          nextGen.delete(messageId)
          const nextCtrl = new Map(state.activeAbortControllers)
          nextCtrl.delete(messageId)
          return {
            generatingMessageIds: nextGen,
            activeAbortControllers: nextCtrl,
          }
        })
      },

      failGeneration: (messageId, error) => {
        const state = get()
        // Finish generation and record error atomically
        const nextGen = new Set(state.generatingMessageIds)
        nextGen.delete(messageId)
        const nextCtrl = new Map(state.activeAbortControllers)
        nextCtrl.delete(messageId)
        const nextErr = new Map(state.errorMap)
        nextErr.set(messageId, { message: error, timestamp: Date.now() })
        set({
          generatingMessageIds: nextGen,
          activeAbortControllers: nextCtrl,
          errorMap: nextErr,
        })
      },

      stopGeneration: async (messageId, sessionId) => {
        const state = get()
        const controller = state.activeAbortControllers.get(messageId)
        if (controller) {
          controller.abort()
        }
        postChatSessionsBySessionIdCancel({ path: { sessionId } }).catch(() => {})
        // Clean up store state
        get().finishGeneration(messageId)
      },

      // --- Session Meta ---

      setSessionMeta: (sessionId, meta) => {
        set((state) => {
          const nextMeta = new Map(state.sessionMetaMap)
          const current = state.sessionMetaMap.get(sessionId) ?? { passiveStatus: 'idle', locallyDriving: false }
          nextMeta.set(sessionId, { ...current, ...meta })
          return { sessionMetaMap: nextMeta }
        })
      },

      setPassiveStatus: (sessionId, status) => {
        set((state) => {
          const nextMeta = new Map(state.sessionMetaMap)
          const current = state.sessionMetaMap.get(sessionId) ?? { passiveStatus: 'idle', locallyDriving: false }
          if (current.passiveStatus === status) {
            return state
          }
          nextMeta.set(sessionId, { ...current, passiveStatus: status })
          return { sessionMetaMap: nextMeta }
        })
      },

      // --- Cleanup ---

      clearSession: (sessionId) => {
        set((state) => {
          const nextMsg = new Map(state.messagesMap)
          nextMsg.delete(sessionId)
          const nextMeta = new Map(state.sessionMetaMap)
          nextMeta.delete(sessionId)
          return { messagesMap: nextMsg, sessionMetaMap: nextMeta }
        })
      },

      clearError: (messageId) => {
        set((state) => {
          const nextErr = new Map(state.errorMap)
          nextErr.delete(messageId)
          return { errorMap: nextErr }
        })
      },
    }),
  ),
)

// ── Selectors ───────────────────────────────────────────────

export const chatSelectors = {
  /** All messages for a session */
  messages: (sessionId: string) => (s: ChatState) =>
    s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES,

  /** Just the message IDs for stable virtualizer keys */
  messageIds: (sessionId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).map(m => m.id),

  /** Single message by ID */
  message: (sessionId: string, messageId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).find(m => m.id === messageId),

  /** Is a specific message actively generating? */
  isGenerating: (messageId: string) => (s: ChatState) =>
    s.generatingMessageIds.has(messageId),

  /** Is any message generating across all sessions? */
  isAnyGenerating: (s: ChatState) =>
    s.generatingMessageIds.size > 0,

  /** Session-level: is this session generating? */
  isSessionGenerating: (sessionId: string) => (s: ChatState) => {
    const messages = s.messagesMap.get(sessionId)
    if (!messages) {
      return false
    }
    return messages.some(m => s.generatingMessageIds.has(m.id))
  },

  /** Error for a message */
  error: (messageId: string) => (s: ChatState) =>
    s.errorMap.get(messageId),

  /** Session meta */
  sessionMeta: (sessionId: string) => (s: ChatState) =>
    s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META,

  /** Resolved visible status combining local + passive */
  visibleStatus: (sessionId: string) => (s: ChatState): PublicStatus => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    const messages = s.messagesMap.get(sessionId)
    const isLocallyStreaming = messages?.some(m => s.generatingMessageIds.has(m.id)) ?? false

    if (isLocallyStreaming) {
      return 'streaming'
    }
    // Check errors for the session's messages
    if (messages?.some(m => s.errorMap.has(m.id))) {
      return 'error'
    }
    return meta.passiveStatus
  },
}

function reconcileMessages(currentMessages: UIMessage[], incomingMessages: UIMessage[]): UIMessage[] {
  if (currentMessages === incomingMessages) {
    return currentMessages
  }
  if (currentMessages.length !== incomingMessages.length) {
    return incomingMessages
  }

  let hasChanges = false
  const nextMessages = incomingMessages.map((incomingMessage, index) => {
    const currentMessage = currentMessages[index]
    if (areMessagesEqual(currentMessage, incomingMessage)) {
      return currentMessage
    }
    hasChanges = true
    return incomingMessage
  })

  return hasChanges ? nextMessages : currentMessages
}

function areMessagesEqual(currentMessage: UIMessage, incomingMessage: UIMessage): boolean {
  return currentMessage.id === incomingMessage.id
    && currentMessage.role === incomingMessage.role
    && areMessagePartsEqual(currentMessage.parts, incomingMessage.parts)
}

function areMessagePartsEqual(currentParts: MessagePart[], incomingParts: MessagePart[]): boolean {
  if (currentParts === incomingParts) {
    return true
  }
  if (currentParts.length !== incomingParts.length) {
    return false
  }

  for (let i = 0; i < currentParts.length; i++) {
    if (!areMessagePartsStructurallyEqual(currentParts[i], incomingParts[i])) {
      return false
    }
  }

  return true
}

function areMessagePartsStructurallyEqual(currentPart: MessagePart, incomingPart: MessagePart): boolean {
  if (currentPart === incomingPart) {
    return true
  }
  if (currentPart.type !== incomingPart.type) {
    return false
  }

  switch (currentPart.type) {
    case 'text':
      return currentPart.text === (incomingPart as { type: 'text', text: string }).text
    case 'reasoning': {
      const currentReasoning = currentPart as unknown as { text?: string, reasoning?: string, state?: string }
      const incomingReasoning = incomingPart as unknown as { text?: string, reasoning?: string, state?: string }
      return currentReasoning.text === incomingReasoning.text
        && currentReasoning.reasoning === incomingReasoning.reasoning
        && currentReasoning.state === incomingReasoning.state
    }
    case 'dynamic-tool': {
      const currentTool = currentPart as unknown as {
        toolCallId?: string
        toolName?: string
        state?: string
        input?: unknown
        output?: unknown
        errorText?: string
      }
      const incomingTool = incomingPart as unknown as {
        toolCallId?: string
        toolName?: string
        state?: string
        input?: unknown
        output?: unknown
        errorText?: string
      }
      return currentTool.toolCallId === incomingTool.toolCallId
        && currentTool.toolName === incomingTool.toolName
        && currentTool.state === incomingTool.state
        && currentTool.errorText === incomingTool.errorText
        && areUnknownValuesEqual(currentTool.input, incomingTool.input)
        && areUnknownValuesEqual(currentTool.output, incomingTool.output)
    }
    default:
      return areUnknownValuesEqual(currentPart, incomingPart)
  }
}

function areUnknownValuesEqual(currentValue: unknown, incomingValue: unknown): boolean {
  if (Object.is(currentValue, incomingValue)) {
    return true
  }
  if (typeof currentValue !== 'object' || currentValue === null || typeof incomingValue !== 'object' || incomingValue === null) {
    return false
  }

  try {
    return JSON.stringify(currentValue) === JSON.stringify(incomingValue)
  }
  catch {
    return false
  }
}
