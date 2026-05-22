import type { UIMessage } from 'ai'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { z } from 'zod'

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
  /** Whether the local UI already requested cancellation and is waiting for canonical server state */
  cancelling: boolean
  /** Message id currently associated with the local stream driver, including pre-SSE temp ids. */
  localDriverMessageId?: string
}

// ── State Interface ─────────────────────────────────────────

interface ChatState {
  // --- Message Data ---
  messagesMap: Map<string, UIMessage[]>

  // --- Subagent Messages (keyed by parent message ID -> parent tool call ID -> messages) ---
  subagentMessagesMap: Map<string, Map<string, UIMessage[]>>

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
  stopGeneration: (messageId: string, sessionId: string) => void

  // --- Actions: Session Meta ---
  setSessionMeta: (sessionId: string, meta: Partial<SessionMeta>) => void
  setPassiveStatus: (sessionId: string, status: PublicStatus) => void

  // --- Actions: Cleanup ---
  clearSession: (sessionId: string) => void
  clearError: (messageId: string) => void

  // --- Actions: Subagent Messages ---
  setSubagentMessages: (messageId: string, messages: Map<string, UIMessage[]>) => void
  upsertSubagentMessage: (messageId: string, parentToolCallId: string, message: UIMessage) => void
}

// ── Server Base ─────────────────────────────────────────────

type MessagePart = UIMessage['parts'][number]
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
const EMPTY_MESSAGES: UIMessage[] = []
const DEFAULT_SESSION_META: SessionMeta = { passiveStatus: 'idle', locallyDriving: false, cancelling: false }
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
)
const TextMessagePartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
}).passthrough()
const ReasoningMessagePartSchema = z.object({
  text: z.string().optional(),
  reasoning: z.string().optional(),
  state: z.string().optional(),
}).passthrough()
const DynamicToolMessagePartSchema = z.object({
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  state: z.string().optional(),
  input: JsonValueSchema.optional(),
  output: JsonValueSchema.optional(),
  errorText: z.string().optional(),
}).passthrough()

// ── Store ───────────────────────────────────────────────────

export const useChatStore = create<ChatState>()(
  subscribeWithSelector(
    (set, get) => ({
      messagesMap: new Map(),
      subagentMessagesMap: new Map(),
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
            ...(state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META),
            cancelling: false,
            locallyDriving: true,
            localDriverMessageId: messageId,
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
          const nextMeta = new Map(state.sessionMetaMap)
          for (const [sessionId, meta] of nextMeta) {
            if (meta.localDriverMessageId === messageId) {
              nextMeta.set(sessionId, {
                ...meta,
                cancelling: false,
                locallyDriving: false,
                localDriverMessageId: undefined,
              })
            }
          }
          return {
            generatingMessageIds: nextGen,
            activeAbortControllers: nextCtrl,
            sessionMetaMap: nextMeta,
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
        const nextMeta = new Map(state.sessionMetaMap)
        for (const [sessionId, meta] of nextMeta) {
          if (meta.localDriverMessageId === messageId) {
            nextMeta.set(sessionId, {
              ...meta,
              cancelling: false,
              locallyDriving: false,
              localDriverMessageId: undefined,
            })
          }
        }
        set({
          generatingMessageIds: nextGen,
          activeAbortControllers: nextCtrl,
          errorMap: nextErr,
          sessionMetaMap: nextMeta,
        })
      },

      stopGeneration: (messageId, sessionId) => {
        const state = get()
        const controller = state.activeAbortControllers.get(messageId)
        if (controller) {
          controller.abort()
        }
        get().finishGeneration(messageId)
        get().setSessionMeta(sessionId, {
          cancelling: true,
          locallyDriving: false,
          localDriverMessageId: undefined,
          passiveStatus: 'idle',
        })
      },

      // --- Session Meta ---

      setSessionMeta: (sessionId, meta) => {
        set((state) => {
          const nextMeta = new Map(state.sessionMetaMap)
          const current = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          nextMeta.set(sessionId, { ...current, ...meta })
          return { sessionMetaMap: nextMeta }
        })
      },

      setPassiveStatus: (sessionId, status) => {
        set((state) => {
          const nextMeta = new Map(state.sessionMetaMap)
          const current = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
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
          const nextSubagents = new Map(state.subagentMessagesMap)
          for (const message of state.messagesMap.get(sessionId) ?? []) {
            nextSubagents.delete(message.id)
          }
          return { messagesMap: nextMsg, sessionMetaMap: nextMeta, subagentMessagesMap: nextSubagents }
        })
      },

      clearError: (messageId) => {
        set((state) => {
          const nextErr = new Map(state.errorMap)
          nextErr.delete(messageId)
          return { errorMap: nextErr }
        })
      },

      // --- Subagent Messages ---

      setSubagentMessages: (messageId, messages) => {
        set((state) => {
          const next = new Map(state.subagentMessagesMap)
          next.set(messageId, messages)
          return { subagentMessagesMap: next }
        })
      },

      upsertSubagentMessage: (messageId, parentToolCallId, message) => {
        set((state) => {
          const next = new Map(state.subagentMessagesMap)
          const messageMap = new Map(next.get(messageId) ?? new Map())
          const currentMessages = messageMap.get(parentToolCallId) ?? []
          const existingIndex = currentMessages.findIndex(item => item.id === message.id)
          const nextMessages = existingIndex === -1
            ? [...currentMessages, message]
            : currentMessages.map(item => item.id === message.id ? message : item)
          messageMap.set(parentToolCallId, nextMessages)
          next.set(messageId, messageMap)
          return { subagentMessagesMap: next }
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
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    if (meta.locallyDriving) {
      return true
    }
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
    if (meta.locallyDriving) {
      return 'streaming'
    }
    const messages = s.messagesMap.get(sessionId)
    const isLocallyStreaming = messages?.some(m => s.generatingMessageIds.has(m.id)) ?? false

    if (isLocallyStreaming) {
      return 'streaming'
    }
    // Check errors for the session's messages
    if (messages?.some(m => s.errorMap.has(m.id))) {
      return 'error'
    }
    if (meta.cancelling) {
      return 'idle'
    }
    return meta.passiveStatus
  },

  /** Subagent messages for a message, keyed by parentToolCallId */
  subagentMessages: (messageId: string) => (s: ChatState) =>
    s.subagentMessagesMap.get(messageId),
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
      return currentPart.text === TextMessagePartSchema.parse(incomingPart).text
    case 'reasoning': {
      const currentReasoning = ReasoningMessagePartSchema.parse(currentPart)
      const incomingReasoning = ReasoningMessagePartSchema.parse(incomingPart)
      return currentReasoning.text === incomingReasoning.text
        && currentReasoning.reasoning === incomingReasoning.reasoning
        && currentReasoning.state === incomingReasoning.state
    }
    case 'dynamic-tool': {
      const currentTool = DynamicToolMessagePartSchema.parse(currentPart)
      const incomingTool = DynamicToolMessagePartSchema.parse(incomingPart)
      return currentTool.toolCallId === incomingTool.toolCallId
        && currentTool.toolName === incomingTool.toolName
        && currentTool.state === incomingTool.state
        && currentTool.errorText === incomingTool.errorText
        && areJsonValuesEqual(currentTool.input, incomingTool.input)
        && areJsonValuesEqual(currentTool.output, incomingTool.output)
    }
    default:
      return areJsonValuesEqual(currentPart, incomingPart)
  }
}

function areJsonValuesEqual(currentValue: unknown, incomingValue: unknown): boolean {
  if (Object.is(currentValue, incomingValue)) {
    return true
  }
  return JSON.stringify(JsonValueSchema.parse(currentValue)) === JSON.stringify(JsonValueSchema.parse(incomingValue))
}
