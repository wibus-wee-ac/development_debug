import type { UIMessage } from 'ai'
import type { Draft } from 'immer'
import { enableMapSet, produce } from 'immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'

import type { ChatToolEntity } from '~/features/chat/chat-tool-entities'
import {
  collectToolCallIdsFromMessages,
  normalizeMessageForToolEntities,
} from '~/features/chat/chat-tool-entities'

enableMapSet()

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
  removeMessage: (sessionId: string, messageId: string) => void
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

}

// ── Server Base ─────────────────────────────────────────────

type MessagePart = UIMessage['parts'][number]
const EMPTY_MESSAGES: UIMessage[] = []
const EMPTY_TOOL_CALL_IDS: string[] = []
const EMPTY_TOOL_ENTITIES: ChatToolEntity[] = []
const DEFAULT_SESSION_META: SessionMeta = { passiveStatus: 'idle', locallyDriving: false, cancelling: false }

// ── Store ───────────────────────────────────────────────────

export const useChatStore = createWithEqualityFn<ChatState>()(
  subscribeWithSelector(
    (set, get) => ({
      messagesMap: new Map(),
      toolCallIdsByMessageId: new Map(),
      toolEntitiesMap: new Map(),
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

          if (
            currentMessages === nextMessages
            && toolState.toolCallIdsByMessageId === state.toolCallIdsByMessageId
            && toolState.toolEntitiesMap === state.toolEntitiesMap
            && (removedMessageIds.length === 0 || state.passiveStreamingMessageIds.size === 0)
          ) {
            return state
          }

          return produce(state, (draft) => {
            draft.messagesMap.set(sessionId, nextMessages)
            if (toolState.toolCallIdsByMessageId !== state.toolCallIdsByMessageId) {
              draft.toolCallIdsByMessageId = toolState.toolCallIdsByMessageId as Draft<Map<string, string[]>>
            }
            if (toolState.toolEntitiesMap !== state.toolEntitiesMap) {
              draft.toolEntitiesMap = toolState.toolEntitiesMap as Draft<Map<string, ChatToolEntity>>
            }
            if (removedMessageIds.length > 0 && state.passiveStreamingMessageIds.size > 0) {
              for (const id of removedMessageIds) {
                draft.passiveStreamingMessageIds.delete(id)
              }
            }
          })
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

          const normalizedMessage = normalizeMessageForToolEntities(updater(messages[idx]))
          const updatedMessage = normalizedMessage.message
          const toolState = withToolEntitiesForMessages(
            state.toolCallIdsByMessageId,
            state.toolEntitiesMap,
            [updatedMessage],
            normalizedMessage.toolEntities,
          )

          return produce(state, (draft) => {
            draft.messagesMap.get(sessionId)![idx] = updatedMessage as Draft<UIMessage>
            if (toolState.toolCallIdsByMessageId !== state.toolCallIdsByMessageId) {
              draft.toolCallIdsByMessageId = toolState.toolCallIdsByMessageId as Draft<Map<string, string[]>>
            }
            if (toolState.toolEntitiesMap !== state.toolEntitiesMap) {
              draft.toolEntitiesMap = toolState.toolEntitiesMap as Draft<Map<string, ChatToolEntity>>
            }
          })
        })
      },

      appendMessage: (sessionId, message) => {
        set((state) => {
          const normalizedMessage = normalizeMessageForToolEntities(message)
          const toolState = withToolEntitiesForMessages(
            state.toolCallIdsByMessageId,
            state.toolEntitiesMap,
            [normalizedMessage.message],
            normalizedMessage.toolEntities,
          )

          return produce(state, (draft) => {
            const messages = draft.messagesMap.get(sessionId)
            if (messages) {
              messages.push(normalizedMessage.message as Draft<UIMessage>)
            }
            else {
              draft.messagesMap.set(sessionId, [normalizedMessage.message as Draft<UIMessage>])
            }
            if (toolState.toolCallIdsByMessageId !== state.toolCallIdsByMessageId) {
              draft.toolCallIdsByMessageId = toolState.toolCallIdsByMessageId as Draft<Map<string, string[]>>
            }
            if (toolState.toolEntitiesMap !== state.toolEntitiesMap) {
              draft.toolEntitiesMap = toolState.toolEntitiesMap as Draft<Map<string, ChatToolEntity>>
            }
          })
        })
      },

      removeMessage: (sessionId, messageId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages?.some(message => message.id === messageId)) {
            return state
          }

          return produce(state, (draft) => {
            const draftMessages = draft.messagesMap.get(sessionId)
            if (draftMessages) {
              const idx = draftMessages.findIndex(m => m.id === messageId)
              if (idx !== -1) {
                draftMessages.splice(idx, 1)
              }
            }

            const toolCallIds = draft.toolCallIdsByMessageId.get(messageId) ?? []
            draft.toolCallIdsByMessageId.delete(messageId)
            for (const toolCallId of toolCallIds) {
              draft.toolEntitiesMap.delete(toolCallId)
            }

            draft.generatingMessageIds.delete(messageId)
            draft.passiveStreamingMessageIds.delete(messageId)
            draft.activeAbortControllers.delete(messageId)
            draft.runDisplayMetaMap.delete(messageId)
            draft.errorMap.delete(messageId)

            const currentMeta = draft.sessionMetaMap.get(sessionId)
            if (currentMeta?.localDriverMessageId === messageId) {
              currentMeta.locallyDriving = false
              currentMeta.localDriverMessageId = undefined
            }
          })
        })
      },

      upsertToolEntity: (entity) => {
        set((state) => {
          const current = state.toolEntitiesMap.get(entity.toolCallId)
          if (current && areToolEntitiesEqual(current, entity)) {
            return state
          }
          return produce(state, (draft) => {
            draft.toolEntitiesMap.set(entity.toolCallId, entity as Draft<ChatToolEntity>)
            const currentIds = draft.toolCallIdsByMessageId.get(entity.messageId)
            if (currentIds) {
              if (!currentIds.includes(entity.toolCallId)) {
                currentIds.push(entity.toolCallId)
              }
            }
            else {
              draft.toolCallIdsByMessageId.set(entity.messageId, [entity.toolCallId])
            }
          })
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
          return produce(state, (draft) => {
            draft.toolEntitiesMap.set(toolCallId, nextEntity as Draft<ChatToolEntity>)
            const currentIds = draft.toolCallIdsByMessageId.get(nextEntity.messageId)
            if (currentIds) {
              if (!currentIds.includes(toolCallId)) {
                currentIds.push(toolCallId)
              }
            }
            else {
              draft.toolCallIdsByMessageId.set(nextEntity.messageId, [toolCallId])
            }
          })
        })
      },

      patchToolEntities: (patches) => {
        if (patches.length === 0) {
          return
        }
        set((state) => {
          let hasChanges = false
          const nextEntities = new Map(state.toolEntitiesMap)
          for (const patch of patches) {
            const current = nextEntities.get(patch.toolCallId) ?? {
              toolCallId: patch.toolCallId,
              messageId: patch.messageId,
              toolName: 'unknown',
              state: 'input-streaming' as const,
            }
            const nextEntity = patch.updater(current)
            if (!areToolEntitiesEqual(current, nextEntity)) {
              nextEntities.set(patch.toolCallId, nextEntity)
              hasChanges = true
            }
          }

          if (!hasChanges) {
            return state
          }

          return produce(state, (draft) => {
            for (const [key, value] of nextEntities) {
              if (value !== state.toolEntitiesMap.get(key)) {
                draft.toolEntitiesMap.set(key, value as Draft<ChatToolEntity>)
              }
            }
            for (const patch of patches) {
              const entity = nextEntities.get(patch.toolCallId)
              if (entity) {
                const currentIds = draft.toolCallIdsByMessageId.get(entity.messageId)
                if (currentIds) {
                  if (!currentIds.includes(patch.toolCallId)) {
                    currentIds.push(patch.toolCallId)
                  }
                }
                else {
                  draft.toolCallIdsByMessageId.set(entity.messageId, [patch.toolCallId])
                }
              }
            }
          })
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

          if (arraysEqual(previousToolCallIds, nextToolCallIds) && mapsEqualByJson(state.toolEntitiesMap, nextEntities)) {
            return state
          }

          return produce(state, (draft) => {
            for (const toolCallId of previousToolCallIds) {
              draft.toolEntitiesMap.delete(toolCallId)
            }
            for (const entity of entities) {
              draft.toolEntitiesMap.set(entity.toolCallId, entity as Draft<ChatToolEntity>)
            }
            if (nextToolCallIds.length > 0) {
              draft.toolCallIdsByMessageId.set(messageId, nextToolCallIds)
            }
            else {
              draft.toolCallIdsByMessageId.delete(messageId)
            }
          })
        })
      },

      clearToolEntitiesForMessage: (messageId) => {
        set((state) => {
          const previousToolCallIds = state.toolCallIdsByMessageId.get(messageId)
          if (!previousToolCallIds || previousToolCallIds.length === 0) {
            return state
          }
          return produce(state, (draft) => {
            draft.toolCallIdsByMessageId.delete(messageId)
            for (const toolCallId of previousToolCallIds) {
              draft.toolEntitiesMap.delete(toolCallId)
            }
          })
        })
      },

      // --- Streaming ---

      startGeneration: (sessionId, messageId, controller) => {
        set((state) => produce(state, (draft) => {
          draft.generatingMessageIds.add(messageId)
          draft.passiveStreamingMessageIds.delete(messageId)
          draft.activeAbortControllers.set(messageId, controller)
          const current = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          draft.sessionMetaMap.set(sessionId, {
            ...current,
            cancelling: false,
            locallyDriving: true,
            localDriverMessageId: messageId,
          })
        }))
      },

      finishGeneration: (messageId) => {
        set((state) => produce(state, (draft) => {
          draft.generatingMessageIds.delete(messageId)
          draft.passiveStreamingMessageIds.delete(messageId)
          draft.activeAbortControllers.delete(messageId)
          const currentRunMeta = draft.runDisplayMetaMap.get(messageId)
          if (currentRunMeta && currentRunMeta.completedAtMs === null) {
            currentRunMeta.completedAtMs = performance.now()
          }
          for (const [sessionId, meta] of draft.sessionMetaMap) {
            if (meta.localDriverMessageId === messageId) {
              meta.cancelling = false
              meta.locallyDriving = false
              meta.localDriverMessageId = undefined
            }
          }
        }))
      },

      failGeneration: (messageId, error) => {
        set((state) => produce(state, (draft) => {
          draft.generatingMessageIds.delete(messageId)
          draft.passiveStreamingMessageIds.delete(messageId)
          draft.activeAbortControllers.delete(messageId)
          draft.errorMap.set(messageId, { message: error, timestamp: Date.now() })
          const currentRunMeta = draft.runDisplayMetaMap.get(messageId)
          if (currentRunMeta && currentRunMeta.completedAtMs === null) {
            currentRunMeta.completedAtMs = performance.now()
          }
          for (const [, meta] of draft.sessionMetaMap) {
            if (meta.localDriverMessageId === messageId) {
              meta.cancelling = false
              meta.locallyDriving = false
              meta.localDriverMessageId = undefined
            }
          }
        }))
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
          return produce(state, (draft) => {
            draft.passiveStreamingMessageIds = nextPassive as Draft<Set<string>>
          })
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
          return produce(state, (draft) => {
            draft.passiveStreamingMessageIds = nextPassive as Draft<Set<string>>
          })
        })
      },

      beginRunDisplayMeta: (messageId, requestStartedAtMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (current?.requestStartedAtMs === requestStartedAtMs) {
            return state
          }
          return produce(state, (draft) => {
            draft.runDisplayMetaMap.set(messageId, {
              runId: current?.runId ?? null,
              requestStartedAtMs,
              firstEventAtMs: current?.firstEventAtMs ?? null,
              firstContentAtMs: current?.firstContentAtMs ?? null,
              completedAtMs: current?.completedAtMs ?? null,
            })
          })
        })
      },

      setRunDisplayId: (messageId, runId) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (current?.runId === runId) {
            return state
          }
          return produce(state, (draft) => {
            draft.runDisplayMetaMap.set(messageId, {
              runId,
              requestStartedAtMs: current?.requestStartedAtMs ?? performance.now(),
              firstEventAtMs: current?.firstEventAtMs ?? null,
              firstContentAtMs: current?.firstContentAtMs ?? null,
              completedAtMs: current?.completedAtMs ?? null,
            })
          })
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
          return produce(state, (draft) => {
            draft.runDisplayMetaMap.delete(fromMessageId)
            draft.runDisplayMetaMap.set(toMessageId, state.runDisplayMetaMap.get(toMessageId) ?? current)
          })
        })
      },

      markRunFirstEvent: (messageId, timestampMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (!current || current.firstEventAtMs !== null) {
            return state
          }
          return produce(state, (draft) => {
            const meta = draft.runDisplayMetaMap.get(messageId)
            if (meta) {
              meta.firstEventAtMs = timestampMs
            }
          })
        })
      },

      markRunFirstContent: (messageId, timestampMs) => {
        set((state) => {
          const current = state.runDisplayMetaMap.get(messageId)
          if (!current || current.firstContentAtMs !== null) {
            return state
          }
          return produce(state, (draft) => {
            const meta = draft.runDisplayMetaMap.get(messageId)
            if (meta) {
              meta.firstContentAtMs = timestampMs
            }
          })
        })
      },

      // --- Session Meta ---

      setSessionMeta: (sessionId, meta) => {
        set((state) => produce(state, (draft) => {
          const current = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          draft.sessionMetaMap.set(sessionId, { ...current, ...meta })
        }))
      },

      setPassiveStatus: (sessionId, status) => {
        set((state) => {
          const current = state.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
          if (current.passiveStatus === status) {
            return state
          }
          return produce(state, (draft) => {
            draft.sessionMetaMap.set(sessionId, { ...current, passiveStatus: status })
          })
        })
      },

      // --- Cleanup ---

      clearSession: (sessionId) => {
        set((state) => {
          const removedMessages = state.messagesMap.get(sessionId) ?? []
          const removedMessageIds = new Set(removedMessages.map(m => m.id))
          return produce(state, (draft) => {
            draft.messagesMap.delete(sessionId)
            draft.sessionMetaMap.delete(sessionId)
            for (const message of removedMessages) {
              draft.runDisplayMetaMap.delete(message.id)
              const toolCallIds = draft.toolCallIdsByMessageId.get(message.id) ?? []
              draft.toolCallIdsByMessageId.delete(message.id)
              for (const toolCallId of toolCallIds) {
                draft.toolEntitiesMap.delete(toolCallId)
              }
            }
            for (const id of removedMessageIds) {
              draft.passiveStreamingMessageIds.delete(id)
            }
          })
        })
      },

      clearError: (messageId) => {
        set((state) => produce(state, (draft) => {
          draft.errorMap.delete(messageId)
        }))
      },

    }),
  ),
  shallow,
)

// ── Selectors ───────────────────────────────────────────────

export const chatSelectors = {
  /** All messages for a session */
  messages: (sessionId: string) => (s: ChatState) =>
    s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES,

  /** Just the message IDs for stable virtualizer keys */
  messageIds: (sessionId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).map(m => m.id),

  messageCount: (sessionId: string) => (s: ChatState) =>
    s.messagesMap.get(sessionId)?.length ?? 0,

  /** Single message by ID */
  message: (sessionId: string, messageId: string) => (s: ChatState) =>
    (s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES).find(m => m.id === messageId),

  lastAssistantId: (sessionId: string) => (s: ChatState) => {
    const messages = s.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i].id
      }
    }
    return undefined
  },

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

  /** Most recent error for a session */
  latestError: (sessionId: string) => (s: ChatState) => {
    const messages = s.messagesMap.get(sessionId)
    if (!messages) return undefined
    let latest: ChatError | undefined
    for (const m of messages) {
      const err = s.errorMap.get(m.id)
      if (err && (!latest || err.timestamp > latest.timestamp)) {
        latest = err
      }
    }
    return latest
  },

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

  toolCallIds: (messageId: string) => (s: ChatState) =>
    s.toolCallIdsByMessageId.get(messageId) ?? EMPTY_TOOL_CALL_IDS,

  toolEntity: (toolCallId: string) => (s: ChatState) =>
    s.toolEntitiesMap.get(toolCallId),

  toolsForMessage: (messageId: string) => (s: ChatState) =>
    (s.toolCallIdsByMessageId.get(messageId) ?? [])
      .map(toolCallId => s.toolEntitiesMap.get(toolCallId))
      .filter((entity): entity is ChatToolEntity => entity !== undefined),

  sessionToolEntities: (() => {
    const cache = new Map<string, { entities: ChatToolEntity[], lastToolCallIds: string[] }>()
    return (sessionId: string) => (s: ChatState) => {
      const messages = s.messagesMap.get(sessionId)
      if (!messages || messages.length === 0) {
        cache.delete(sessionId)
        return EMPTY_TOOL_ENTITIES
      }

      const toolCallIds: string[] = []
      for (const message of messages) {
        const ids = s.toolCallIdsByMessageId.get(message.id)
        if (ids) {
          toolCallIds.push(...ids)
        }
      }

      if (toolCallIds.length === 0) {
        cache.delete(sessionId)
        return EMPTY_TOOL_ENTITIES
      }

      const prev = cache.get(sessionId)
      if (prev && arraysEqual(prev.lastToolCallIds, toolCallIds)) {
        let stale = false
        for (let i = 0; i < prev.entities.length; i++) {
          if (prev.entities[i] !== s.toolEntitiesMap.get(toolCallIds[i])) {
            stale = true
            break
          }
        }
        if (!stale) {
          return prev.entities
        }
      }

      const entities: ChatToolEntity[] = []
      for (const toolCallId of toolCallIds) {
        const entity = s.toolEntitiesMap.get(toolCallId)
        if (entity) {
          entities.push(entity)
        }
      }
      const result = entities.length > 0 ? entities : EMPTY_TOOL_ENTITIES
      cache.set(sessionId, { entities: result, lastToolCallIds: toolCallIds })
      return result
    }
  })(),

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
    && areJsonValuesEqual(
      (currentMessage as { metadata?: unknown }).metadata ?? null,
      (incomingMessage as { metadata?: unknown }).metadata ?? null,
    )
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
      return readPartText(currentPart) === readPartText(incomingPart)
    case 'reasoning': {
      const currentReasoning = readReasoningPart(currentPart)
      const incomingReasoning = readReasoningPart(incomingPart)
      return currentReasoning.text === incomingReasoning.text
        && currentReasoning.reasoning === incomingReasoning.reasoning
        && currentReasoning.state === incomingReasoning.state
    }
    case 'dynamic-tool': {
      const currentTool = readDynamicToolPart(currentPart)
      const incomingTool = readDynamicToolPart(incomingPart)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readPartText(part: MessagePart): string | undefined {
  if (!isRecord(part)) {
    return undefined
  }
  const record = part as Record<string, unknown>
  return typeof record.text === 'string' ? record.text : undefined
}

function readReasoningPart(part: MessagePart): { text?: string, reasoning?: string, state?: string } {
  const record = isRecord(part) ? part as Record<string, unknown> : {}
  return {
    text: typeof record.text === 'string' ? record.text : undefined,
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
    state: typeof record.state === 'string' ? record.state : undefined,
  }
}

function readDynamicToolPart(part: MessagePart): DynamicToolMessagePart {
  const record = isRecord(part) ? part as Record<string, unknown> : {}
  return {
    toolCallId: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    toolName: typeof record.toolName === 'string' ? record.toolName : undefined,
    state: typeof record.state === 'string' ? record.state : undefined,
  }
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
    && areJsonValuesEqual(left.approval, right.approval)
    && left.preliminary === right.preliminary
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
  return JSON.stringify(currentValue) === JSON.stringify(incomingValue)
}
