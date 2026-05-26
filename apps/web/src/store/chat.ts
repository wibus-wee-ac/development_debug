import type { UIMessage } from 'ai'
import { z } from 'zod'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type { ChatToolEntity } from '~/features/chat/chat-tool-entities'
import {
  collectToolCallIdsFromMessages,
  collectToolCallIdsFromSubagentMap,
  normalizeMessageForToolEntities,
} from '~/features/chat/chat-tool-entities'

// ── Types ───────────────────────────────────────────────────

export type PublicStatus = 'idle' | 'streaming' | 'error'

interface ChatError {
  message: string
  timestamp: number
}

export interface ChatRunDisplayMeta {
  runId: string | null
  requestStartedAtMs: number
  firstEventAtMs: number | null
  firstContentAtMs: number | null
  completedAtMs: number | null
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
  toolCallIdsByMessageId: Map<string, string[]>
  toolEntitiesMap: Map<string, ChatToolEntity>

  // --- Subagent Messages (keyed by parent message ID -> parent tool call ID -> messages) ---
  subagentMessagesMap: Map<string, Map<string, UIMessage[]>>

  // --- Streaming State ---
  generatingMessageIds: Set<string>
  passiveStreamingMessageIds: Set<string>
  activeAbortControllers: Map<string, AbortController>
  runDisplayMetaMap: Map<string, ChatRunDisplayMeta>

  // --- Error State ---
  errorMap: Map<string, ChatError>

  // --- Session Meta ---
  sessionMetaMap: Map<string, SessionMeta>

  // --- Actions: Messages ---
  setMessages: (sessionId: string, messages: UIMessage[]) => void
  updateMessage: (sessionId: string, messageId: string, updater: (msg: UIMessage) => UIMessage) => void
  appendMessage: (sessionId: string, message: UIMessage) => void
  upsertToolEntity: (entity: ChatToolEntity) => void
  patchToolEntity: (
    messageId: string,
    toolCallId: string,
    updater: (entity: ChatToolEntity) => ChatToolEntity,
  ) => void
  patchToolEntities: (patches: Array<{
    messageId: string
    toolCallId: string
    updater: (entity: ChatToolEntity) => ChatToolEntity
  }>) => void
  replaceToolEntitiesForMessage: (messageId: string, entities: ChatToolEntity[]) => void
  clearToolEntitiesForMessage: (messageId: string) => void

  // --- Actions: Streaming ---
  startGeneration: (sessionId: string, messageId: string, controller: AbortController) => void
  finishGeneration: (messageId: string) => void
  failGeneration: (messageId: string, error: string) => void
  stopGeneration: (messageId: string, sessionId: string) => void
  setPassiveStreamingMessageIds: (sessionId: string, messageIds: string[]) => void
  setPassiveStreamingMessage: (sessionId: string, messageId: string, streaming: boolean) => void
  beginRunDisplayMeta: (messageId: string, requestStartedAtMs: number) => void
  setRunDisplayId: (messageId: string, runId: string) => void
  moveRunDisplayMeta: (fromMessageId: string, toMessageId: string) => void
  markRunFirstEvent: (messageId: string, timestampMs: number) => void
  markRunFirstContent: (messageId: string, timestampMs: number) => void

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
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy((): z.ZodType<JsonValue> =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]))
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
      toolCallIdsByMessageId: new Map(),
      toolEntitiesMap: new Map(),
      subagentMessagesMap: new Map(),
      generatingMessageIds: new Set(),
      passiveStreamingMessageIds: new Set(),
      activeAbortControllers: new Map(),
      runDisplayMetaMap: new Map(),
      errorMap: new Map(),
      sessionMetaMap: new Map(),

      // --- Messages ---

      setMessages: (sessionId, messages) => {
        set((state) => {
          const normalizedMessages = messages.map(normalizeMessageForToolEntities)
          const projectedMessages = normalizedMessages.map(item => item.message)
          const currentMessages = state.messagesMap.get(sessionId)
          const nextMessages = currentMessages
            ? reconcileMessages(currentMessages, projectedMessages)
            : projectedMessages

          const currentSessionMessageIds = new Set(
            (state.messagesMap.get(sessionId) ?? []).map(message => message.id),
          )
          const nextSessionMessageIds = new Set(projectedMessages.map(message => message.id))
          const sessionMessageIdsChanged = currentSessionMessageIds.size !== nextSessionMessageIds.size
            || [...currentSessionMessageIds].some(id => !nextSessionMessageIds.has(id))
          const removedMessageIds = sessionMessageIdsChanged
            ? [...currentSessionMessageIds].filter(id => !nextSessionMessageIds.has(id))
            : []
          const toolState = withToolEntitiesForMessages(
            state.toolCallIdsByMessageId,
            state.toolEntitiesMap,
            projectedMessages,
            normalizedMessages.flatMap(item => item.toolEntities),
            removedMessageIds,
          )
          const nextPassiveStreamingMessageIds = removedMessageIds.length > 0
            ? new Set([...state.passiveStreamingMessageIds].filter(id => !removedMessageIds.includes(id)))
            : state.passiveStreamingMessageIds

          if (
            currentMessages === nextMessages
            && toolState.toolCallIdsByMessageId === state.toolCallIdsByMessageId
            && toolState.toolEntitiesMap === state.toolEntitiesMap
            && nextPassiveStreamingMessageIds === state.passiveStreamingMessageIds
          ) {
            return state
          }

          const next = new Map(state.messagesMap)
          next.set(sessionId, nextMessages)
          return {
            messagesMap: next,
            toolCallIdsByMessageId: toolState.toolCallIdsByMessageId,
            toolEntitiesMap: toolState.toolEntitiesMap,
            passiveStreamingMessageIds: nextPassiveStreamingMessageIds,
          }
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

          const updatedMessage = updater(messages[idx])
          const updated = [...messages]
          updated[idx] = updatedMessage

          const next = new Map(state.messagesMap)
          next.set(sessionId, updated)
          return {
            messagesMap: next,
          }
        })
      },

      appendMessage: (sessionId, message) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId) ?? []
          const normalizedMessage = normalizeMessageForToolEntities(message)
          const next = new Map(state.messagesMap)
          next.set(sessionId, [...messages, normalizedMessage.message])
          const toolState = withToolEntitiesForMessages(
            state.toolCallIdsByMessageId,
            state.toolEntitiesMap,
            [normalizedMessage.message],
            normalizedMessage.toolEntities,
          )
          return {
            messagesMap: next,
            toolCallIdsByMessageId: toolState.toolCallIdsByMessageId,
            toolEntitiesMap: toolState.toolEntitiesMap,
          }
        })
      },

      upsertToolEntity: (entity) => {
        set((state) => {
          const current = state.toolEntitiesMap.get(entity.toolCallId)
          if (current && areToolEntitiesEqual(current, entity)) {
            return state
          }
          const nextEntities = new Map(state.toolEntitiesMap)
          nextEntities.set(entity.toolCallId, entity)
          const nextToolCallIdsByMessageId = upsertMessageToolCallIds(
            state.toolCallIdsByMessageId,
            entity.messageId,
            entity.toolCallId,
          )
          return {
            toolEntitiesMap: nextEntities,
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
          }
        })
      },

      patchToolEntity: (messageId, toolCallId, updater) => {
        set((state) => {
          const current = state.toolEntitiesMap.get(toolCallId) ?? {
            toolCallId,
            messageId,
            toolName: 'unknown',
            state: 'input-streaming' as const,
          }
          const nextEntity = updater(current)
          if (areToolEntitiesEqual(current, nextEntity)) {
            return state
          }
          const nextEntities = new Map(state.toolEntitiesMap)
          nextEntities.set(toolCallId, nextEntity)
          const nextToolCallIdsByMessageId = upsertMessageToolCallIds(
            state.toolCallIdsByMessageId,
            nextEntity.messageId,
            toolCallId,
          )
          return {
            toolEntitiesMap: nextEntities,
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
          }
        })
      },

      patchToolEntities: (patches) => {
        if (patches.length === 0) {
          return
        }
        set((state) => {
          let nextEntities = state.toolEntitiesMap
          let nextToolCallIdsByMessageId = state.toolCallIdsByMessageId

          for (const patch of patches) {
            const current = nextEntities.get(patch.toolCallId) ?? {
              toolCallId: patch.toolCallId,
              messageId: patch.messageId,
              toolName: 'unknown',
              state: 'input-streaming' as const,
            }
            const nextEntity = patch.updater(current)
            if (areToolEntitiesEqual(current, nextEntity)) {
              continue
            }
            if (nextEntities === state.toolEntitiesMap) {
              nextEntities = new Map(nextEntities)
            }
            nextEntities.set(patch.toolCallId, nextEntity)
            nextToolCallIdsByMessageId = upsertMessageToolCallIds(
              nextToolCallIdsByMessageId,
              nextEntity.messageId,
              patch.toolCallId,
            )
          }

          if (
            nextEntities === state.toolEntitiesMap
            && nextToolCallIdsByMessageId === state.toolCallIdsByMessageId
          ) {
            return state
          }
          return {
            toolEntitiesMap: nextEntities,
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
          }
        })
      },

      replaceToolEntitiesForMessage: (messageId, entities) => {
        set((state) => {
          const previousToolCallIds = state.toolCallIdsByMessageId.get(messageId) ?? []
          const nextToolCallIds = entities.map(entity => entity.toolCallId)
          const nextEntities = new Map(state.toolEntitiesMap)

          for (const toolCallId of previousToolCallIds) {
            nextEntities.delete(toolCallId)
          }
          for (const entity of entities) {
            nextEntities.set(entity.toolCallId, entity)
          }

          const nextToolCallIdsByMessageId = new Map(state.toolCallIdsByMessageId)
          if (nextToolCallIds.length > 0) {
            nextToolCallIdsByMessageId.set(messageId, nextToolCallIds)
          }
          else {
            nextToolCallIdsByMessageId.delete(messageId)
          }

          if (arraysEqual(previousToolCallIds, nextToolCallIds) && mapsEqualByJson(state.toolEntitiesMap, nextEntities)) {
            return state
          }

          return {
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
            toolEntitiesMap: nextEntities,
          }
        })
      },

      clearToolEntitiesForMessage: (messageId) => {
        set((state) => {
          const previousToolCallIds = state.toolCallIdsByMessageId.get(messageId)
          if (!previousToolCallIds || previousToolCallIds.length === 0) {
            return state
          }
          const nextToolCallIdsByMessageId = new Map(state.toolCallIdsByMessageId)
          nextToolCallIdsByMessageId.delete(messageId)
          const nextEntities = new Map(state.toolEntitiesMap)
          for (const toolCallId of previousToolCallIds) {
            nextEntities.delete(toolCallId)
          }
          return {
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
            toolEntitiesMap: nextEntities,
          }
        })
      },

      // --- Streaming ---

      startGeneration: (sessionId, messageId, controller) => {
        set((state) => {
          const nextGen = new Set(state.generatingMessageIds)
          nextGen.add(messageId)
          const nextPassiveStreamingMessageIds = new Set(state.passiveStreamingMessageIds)
          nextPassiveStreamingMessageIds.delete(messageId)
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
            passiveStreamingMessageIds: nextPassiveStreamingMessageIds,
            activeAbortControllers: nextCtrl,
            sessionMetaMap: nextMeta,
          }
        })
      },

      finishGeneration: (messageId) => {
        set((state) => {
          const nextGen = new Set(state.generatingMessageIds)
          nextGen.delete(messageId)
          const nextPassiveStreamingMessageIds = new Set(state.passiveStreamingMessageIds)
          nextPassiveStreamingMessageIds.delete(messageId)
          const nextCtrl = new Map(state.activeAbortControllers)
          nextCtrl.delete(messageId)
          const nextMeta = new Map(state.sessionMetaMap)
          const nextRunMeta = new Map(state.runDisplayMetaMap)
          const currentRunMeta = nextRunMeta.get(messageId)
          if (currentRunMeta && currentRunMeta.completedAtMs === null) {
            nextRunMeta.set(messageId, { ...currentRunMeta, completedAtMs: performance.now() })
          }
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
            passiveStreamingMessageIds: nextPassiveStreamingMessageIds,
            activeAbortControllers: nextCtrl,
            sessionMetaMap: nextMeta,
            runDisplayMetaMap: nextRunMeta,
          }
        })
      },

      failGeneration: (messageId, error) => {
        const state = get()
        // Finish generation and record error atomically
        const nextGen = new Set(state.generatingMessageIds)
        nextGen.delete(messageId)
        const nextPassiveStreamingMessageIds = new Set(state.passiveStreamingMessageIds)
        nextPassiveStreamingMessageIds.delete(messageId)
        const nextCtrl = new Map(state.activeAbortControllers)
        nextCtrl.delete(messageId)
        const nextErr = new Map(state.errorMap)
        nextErr.set(messageId, { message: error, timestamp: Date.now() })
        const nextRunMeta = new Map(state.runDisplayMetaMap)
        const currentRunMeta = nextRunMeta.get(messageId)
        if (currentRunMeta && currentRunMeta.completedAtMs === null) {
          nextRunMeta.set(messageId, { ...currentRunMeta, completedAtMs: performance.now() })
        }
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
          passiveStreamingMessageIds: nextPassiveStreamingMessageIds,
          activeAbortControllers: nextCtrl,
          errorMap: nextErr,
          runDisplayMetaMap: nextRunMeta,
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

      setPassiveStreamingMessageIds: (sessionId, messageIds) => {
        set((state) => {
          const sessionMessageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
          const nextPassive = new Set(state.passiveStreamingMessageIds)
          for (const messageId of sessionMessageIds) {
            nextPassive.delete(messageId)
          }
          for (const messageId of messageIds) {
            if (sessionMessageIds.has(messageId) && !state.generatingMessageIds.has(messageId)) {
              nextPassive.add(messageId)
            }
          }
          if (areSetsEqual(nextPassive, state.passiveStreamingMessageIds)) {
            return state
          }
          return { passiveStreamingMessageIds: nextPassive }
        })
      },

      setPassiveStreamingMessage: (sessionId, messageId, streaming) => {
        set((state) => {
          const sessionMessageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
          const nextPassive = new Set(state.passiveStreamingMessageIds)
          if (streaming && sessionMessageIds.has(messageId) && !state.generatingMessageIds.has(messageId)) {
            nextPassive.add(messageId)
          }
          else {
            nextPassive.delete(messageId)
          }
          if (areSetsEqual(nextPassive, state.passiveStreamingMessageIds)) {
            return state
          }
          return { passiveStreamingMessageIds: nextPassive }
        })
      },

      beginRunDisplayMeta: (messageId, requestStartedAtMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (current?.requestStartedAtMs === requestStartedAtMs) {
            return state
          }
          const next = new Map(state.runDisplayMetaMap)
          next.set(messageId, {
            runId: current?.runId ?? null,
            requestStartedAtMs,
            firstEventAtMs: current?.firstEventAtMs ?? null,
            firstContentAtMs: current?.firstContentAtMs ?? null,
            completedAtMs: current?.completedAtMs ?? null,
          })
          return { runDisplayMetaMap: next }
        })
      },

      setRunDisplayId: (messageId, runId) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (current?.runId === runId) {
            return state
          }
          const next = new Map(state.runDisplayMetaMap)
          next.set(messageId, {
            runId,
            requestStartedAtMs: current?.requestStartedAtMs ?? performance.now(),
            firstEventAtMs: current?.firstEventAtMs ?? null,
            firstContentAtMs: current?.firstContentAtMs ?? null,
            completedAtMs: current?.completedAtMs ?? null,
          })
          return { runDisplayMetaMap: next }
        })
      },

      moveRunDisplayMeta: (fromMessageId, toMessageId) => {
        if (fromMessageId === toMessageId) {
          return
        }
        set((state) => {
          const current = state.runDisplayMetaMap.get(fromMessageId)
          if (!current) {
            return state
          }
          const next = new Map(state.runDisplayMetaMap)
          next.delete(fromMessageId)
          next.set(toMessageId, state.runDisplayMetaMap.get(toMessageId) ?? current)
          return { runDisplayMetaMap: next }
        })
      },

      markRunFirstEvent: (messageId, timestampMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (!current || current.firstEventAtMs !== null) {
            return state
          }
          const next = new Map(state.runDisplayMetaMap)
          next.set(messageId, { ...current, firstEventAtMs: timestampMs })
          return { runDisplayMetaMap: next }
        })
      },

      markRunFirstContent: (messageId, timestampMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (!current || current.firstContentAtMs !== null) {
            return state
          }
          const next = new Map(state.runDisplayMetaMap)
          next.set(messageId, { ...current, firstContentAtMs: timestampMs })
          return { runDisplayMetaMap: next }
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
          const nextMeta = new Map(state.sessionMetaMap)
          nextMeta.delete(sessionId)
          const nextSubagents = new Map(state.subagentMessagesMap)
          const nextToolCallIdsByMessageId = new Map(state.toolCallIdsByMessageId)
          const nextToolEntitiesMap = new Map(state.toolEntitiesMap)
          const nextRunDisplayMetaMap = new Map(state.runDisplayMetaMap)
          const removedMessages = state.messagesMap.get(sessionId) ?? []
          nextMsg.delete(sessionId)
          for (const message of removedMessages) {
            nextRunDisplayMetaMap.delete(message.id)
            nextSubagents.delete(message.id)
            const toolCallIds = nextToolCallIdsByMessageId.get(message.id) ?? []
            nextToolCallIdsByMessageId.delete(message.id)
            for (const toolCallId of toolCallIds) {
              nextToolEntitiesMap.delete(toolCallId)
            }
          }
          return {
            messagesMap: nextMsg,
            sessionMetaMap: nextMeta,
            subagentMessagesMap: nextSubagents,
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
            toolEntitiesMap: nextToolEntitiesMap,
            runDisplayMetaMap: nextRunDisplayMetaMap,
            passiveStreamingMessageIds: new Set(
              [...state.passiveStreamingMessageIds].filter(id => !removedMessages.some(message => message.id === id)),
            ),
          }
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
          const nextToolCallIdsByMessageId = new Map(state.toolCallIdsByMessageId)
          const nextToolEntitiesMap = new Map(state.toolEntitiesMap)
          const staleToolCallIds = collectToolCallIdsFromSubagentMap(state.subagentMessagesMap.get(messageId) ?? new Map())
          for (const toolCallId of staleToolCallIds) {
            nextToolEntitiesMap.delete(toolCallId)
          }
          for (const subMessages of messages.values()) {
            for (const subMessage of subMessages) {
              const normalizedSubMessage = normalizeMessageForToolEntities(subMessage)
              nextToolCallIdsByMessageId.set(
                normalizedSubMessage.message.id,
                collectToolCallIdsFromMessages([normalizedSubMessage.message]),
              )
              for (const entity of normalizedSubMessage.toolEntities) {
                nextToolEntitiesMap.set(entity.toolCallId, entity)
              }
            }
          }
          return {
            subagentMessagesMap: next,
            toolCallIdsByMessageId: nextToolCallIdsByMessageId,
            toolEntitiesMap: nextToolEntitiesMap,
          }
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
          return {
            subagentMessagesMap: next,
          }
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

  /** Is a specific message actively streaming in this renderer or through passive snapshot recovery? */
  isStreamingMessage: (messageId: string) => (s: ChatState) =>
    s.generatingMessageIds.has(messageId) || s.passiveStreamingMessageIds.has(messageId),

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

  toolCallIds: (messageId: string) => (s: ChatState) =>
    s.toolCallIdsByMessageId.get(messageId) ?? [],

  toolEntity: (toolCallId: string) => (s: ChatState) =>
    s.toolEntitiesMap.get(toolCallId),

  toolsForMessage: (messageId: string) => (s: ChatState) =>
    (s.toolCallIdsByMessageId.get(messageId) ?? [])
      .map(toolCallId => s.toolEntitiesMap.get(toolCallId))
      .filter((entity): entity is ChatToolEntity => entity !== undefined),

  runDisplayMeta: (messageId: string) => (s: ChatState) =>
    s.runDisplayMetaMap.get(messageId),
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
      const currentTool = DynamicToolMessagePartSchema.parse(currentPart) as DynamicToolMessagePart
      const incomingTool = DynamicToolMessagePartSchema.parse(incomingPart) as DynamicToolMessagePart
      return currentTool.toolCallId === incomingTool.toolCallId
        && currentTool.toolName === incomingTool.toolName
        && currentTool.state === incomingTool.state
    }
    default:
      return areJsonValuesEqual(currentPart, incomingPart)
  }
}

interface DynamicToolMessagePart {
  toolCallId?: string
  toolName?: string
  state?: string
}

function withToolEntitiesForMessages(
  currentToolCallIdsByMessageId: Map<string, string[]>,
  currentToolEntitiesMap: Map<string, ChatToolEntity>,
  messages: UIMessage[],
  entities: ChatToolEntity[],
  removedMessageIds: string[] = [],
): {
  toolCallIdsByMessageId: Map<string, string[]>
  toolEntitiesMap: Map<string, ChatToolEntity>
} {
  let toolCallIdsByMessageId = currentToolCallIdsByMessageId
  let toolEntitiesMap = currentToolEntitiesMap

  for (const removedMessageId of removedMessageIds) {
    const existingToolCallIds = toolCallIdsByMessageId.get(removedMessageId) ?? []
    if (existingToolCallIds.length > 0) {
      if (toolCallIdsByMessageId === currentToolCallIdsByMessageId) {
        toolCallIdsByMessageId = new Map(toolCallIdsByMessageId)
      }
      if (toolEntitiesMap === currentToolEntitiesMap) {
        toolEntitiesMap = new Map(toolEntitiesMap)
      }
      toolCallIdsByMessageId.delete(removedMessageId)
      for (const toolCallId of existingToolCallIds) {
        toolEntitiesMap.delete(toolCallId)
      }
    }
  }

  const entitiesByMessageId = new Map<string, ChatToolEntity[]>()
  for (const entity of entities) {
    const messageEntities = entitiesByMessageId.get(entity.messageId) ?? []
    messageEntities.push(entity)
    entitiesByMessageId.set(entity.messageId, messageEntities)
  }

  for (const message of messages) {
    const nextToolCallIds = entitiesByMessageId.get(message.id)?.map(entity => entity.toolCallId)
      ?? collectToolCallIdsFromMessages([message])
    const previousToolCallIds = toolCallIdsByMessageId.get(message.id) ?? []
    const toolCallIdsChanged = !arraysEqual(previousToolCallIds, nextToolCallIds)

    if (toolCallIdsChanged) {
      if (toolCallIdsByMessageId === currentToolCallIdsByMessageId) {
        toolCallIdsByMessageId = new Map(toolCallIdsByMessageId)
      }
      if (toolEntitiesMap === currentToolEntitiesMap) {
        toolEntitiesMap = new Map(toolEntitiesMap)
      }
      if (nextToolCallIds.length > 0) {
        toolCallIdsByMessageId.set(message.id, nextToolCallIds)
      }
      else {
        toolCallIdsByMessageId.delete(message.id)
      }
      for (const staleToolCallId of previousToolCallIds) {
        if (!nextToolCallIds.includes(staleToolCallId)) {
          toolEntitiesMap.delete(staleToolCallId)
        }
      }
    }

    const nextEntities = entitiesByMessageId.get(message.id) ?? []
    for (const entity of nextEntities) {
      const previousEntity = toolEntitiesMap.get(entity.toolCallId)
      if (!previousEntity || !areToolEntitiesEqual(previousEntity, entity)) {
        if (toolEntitiesMap === currentToolEntitiesMap) {
          toolEntitiesMap = new Map(toolEntitiesMap)
        }
        toolEntitiesMap.set(entity.toolCallId, entity)
      }
    }
  }

  return { toolCallIdsByMessageId, toolEntitiesMap }
}

function upsertMessageToolCallIds(
  current: Map<string, string[]>,
  messageId: string,
  toolCallId: string,
): Map<string, string[]> {
  const currentIds = current.get(messageId) ?? []
  if (currentIds.includes(toolCallId)) {
    return current
  }
  const next = new Map(current)
  next.set(messageId, [...currentIds, toolCallId])
  return next
}

function areToolEntitiesEqual(left: ChatToolEntity, right: ChatToolEntity): boolean {
  return left.toolCallId === right.toolCallId
    && left.messageId === right.messageId
    && left.toolName === right.toolName
    && left.state === right.state
    && left.argumentsText === right.argumentsText
    && left.errorText === right.errorText
    && areJsonValuesEqual(left.input, right.input)
    && areJsonValuesEqual(left.output, right.output)
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false
    }
  }
  return true
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left === right) {
    return true
  }
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

function mapsEqualByJson(left: Map<string, ChatToolEntity>, right: Map<string, ChatToolEntity>): boolean {
  if (left === right) {
    return true
  }
  if (left.size !== right.size) {
    return false
  }
  for (const [key, value] of left) {
    const rightValue = right.get(key)
    if (!rightValue || !areToolEntitiesEqual(value, rightValue)) {
      return false
    }
  }
  return true
}

function areJsonValuesEqual(currentValue: unknown, incomingValue: unknown): boolean {
  if (Object.is(currentValue, incomingValue)) {
    return true
  }
  if (currentValue === undefined || incomingValue === undefined) {
    return false
  }
  return JSON.stringify(JsonValueSchema.parse(currentValue)) === JSON.stringify(JsonValueSchema.parse(incomingValue))
}
