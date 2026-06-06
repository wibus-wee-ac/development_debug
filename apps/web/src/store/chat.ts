import type { UIMessage } from 'ai'
import isEqual from 'fast-deep-equal'
import type { Draft } from 'immer'
import { enableMapSet, produce } from 'immer'
import { subscribeWithSelector } from 'zustand/middleware'
import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'

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

export type ChatActiveGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'

export interface ChatActiveGoal {
  sessionId: string
  objective: string
  status: ChatActiveGoalStatus
  sourceMessageId: string | null
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
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

interface AssistantDisplaySplit {
  sourceMessageId: string
  tailMessageId: string
  splitParts: UIMessage['parts']
  insertedMessageIds: string[]
  insertedQueueItemIds: string[]
}

// ── State Interface ─────────────────────────────────────────

interface ChatState {
  // --- Message Data ---
  messagesMap: Map<string, UIMessage[]>
  hydratedSessionIds: Set<string>

  // --- Streaming State ---
  generatingMessageIds: Set<string>
  passiveStreamingMessageIds: Set<string>
  activeAbortControllers: Map<string, AbortController>
  runDisplayMetaMap: Map<string, ChatRunDisplayMeta>

  // --- Error State ---
  errorMap: Map<string, ChatError>

  // --- Session Meta ---
  sessionMetaMap: Map<string, SessionMeta>
  activeGoalMap: Map<string, ChatActiveGoal>
  assistantDisplaySplitMap: Map<string, AssistantDisplaySplit>

  // --- Actions: Messages ---
  setMessages: (sessionId: string, messages: UIMessage[]) => void
  updateMessage: (sessionId: string, messageId: string, updater: (msg: UIMessage) => UIMessage, change?: MessageReconcileChange) => void
  appendMessage: (sessionId: string, message: UIMessage) => void
  insertLiveSteerMessage: (sessionId: string, message: UIMessage, sourceMessageId?: string | null) => void
  removeMessage: (sessionId: string, messageId: string) => void

  // --- Actions: Streaming ---
  startGeneration: (sessionId: string, messageId: string, controller: AbortController) => void
  finishGeneration: (messageId: string) => void
  failGeneration: (messageId: string, error: string) => void
  stopGeneration: (messageId: string, sessionId: string) => void
  moveStreamingMessage: (sessionId: string, fromMessageId: string, toMessageId: string) => void
  setPassiveStreamingMessageIds: (sessionId: string, messageIds: string[]) => void
  setPassiveStreamingMessage: (sessionId: string, messageId: string, streaming: boolean) => void
  beginRunDisplayMeta: (messageId: string, requestStartedAtMs: number) => void
  setRunDisplayId: (messageId: string, runId: string) => void
  moveRunDisplayMeta: (fromMessageId: string, toMessageId: string) => void
  markRunFirstEvent: (messageId: string, timestampMs: number) => void
  markRunFirstContent: (messageId: string, timestampMs: number) => void
  projectStreamingMessageForDisplay: (sessionId: string, message: UIMessage) => UIMessage

  // --- Actions: Session Meta ---
  setSessionMeta: (sessionId: string, meta: Partial<SessionMeta>) => void
  setPassiveStatus: (sessionId: string, status: PublicStatus) => void
  setSessionHydrated: (sessionId: string, hydrated: boolean) => void
  setActiveGoal: (sessionId: string, input: {
    objective: string
    sourceMessageId?: string | null
    status?: ChatActiveGoalStatus
    tokenBudget?: number | null
  }) => void
  clearActiveGoal: (sessionId: string) => void

  // --- Actions: Cleanup ---
  clearSession: (sessionId: string) => void
  clearError: (messageId: string) => void
  clearSessionErrors: (sessionId: string) => void

}

// ── Server Base ─────────────────────────────────────────────

type MessagePart = UIMessage['parts'][number]
const EMPTY_MESSAGES: UIMessage[] = []
const DEFAULT_SESSION_META: SessionMeta = { passiveStatus: 'idle', locallyDriving: false, cancelling: false }

export interface MessageReconcileChange {
  dirtyToolCallIds?: ReadonlySet<string>
}

// ── Store ───────────────────────────────────────────────────

export const useChatStore = createWithEqualityFn<ChatState>()(
  subscribeWithSelector(
    (set, get) => ({
      messagesMap: new Map(),
      hydratedSessionIds: new Set(),
      generatingMessageIds: new Set(),
      passiveStreamingMessageIds: new Set(),
      activeAbortControllers: new Map(),
      runDisplayMetaMap: new Map(),
      errorMap: new Map(),
      sessionMetaMap: new Map(),
      activeGoalMap: new Map(),
      assistantDisplaySplitMap: new Map(),

      // --- Messages ---

      setMessages: (sessionId, messages) => {
        set((state) => {
          const assistantDisplaySplitMap = hydrateAssistantDisplaySplits(messages, state.assistantDisplaySplitMap)
          const displayMessages = applyAssistantDisplaySplits(messages, assistantDisplaySplitMap)
          const currentMessages = state.messagesMap.get(sessionId)
          const nextMessages = currentMessages
            ? reconcileMessages(currentMessages, displayMessages)
            : displayMessages
          const splitMapChanged = assistantDisplaySplitMap !== state.assistantDisplaySplitMap

          const currentSessionMessageIds = new Set(
            (state.messagesMap.get(sessionId) ?? []).map(message => message.id),
          )
          const nextSessionMessageIds = new Set(displayMessages.map(message => message.id))
          const sessionMessageIdsChanged = currentSessionMessageIds.size !== nextSessionMessageIds.size
            || [...currentSessionMessageIds].some(id => !nextSessionMessageIds.has(id))
          const removedMessageIds = sessionMessageIdsChanged
            ? [...currentSessionMessageIds].filter(id => !nextSessionMessageIds.has(id))
            : []
          if (
            currentMessages === nextMessages
            && !splitMapChanged
            && (removedMessageIds.length === 0 || state.passiveStreamingMessageIds.size === 0)
          ) {
            return state
          }

          return produce(state, (draft) => {
            draft.messagesMap.set(sessionId, nextMessages)
            if (splitMapChanged) {
              draft.assistantDisplaySplitMap = assistantDisplaySplitMap as Draft<Map<string, AssistantDisplaySplit>>
            }
            if (removedMessageIds.length > 0 && state.passiveStreamingMessageIds.size > 0) {
              for (const id of removedMessageIds) {
                draft.passiveStreamingMessageIds.delete(id)
              }
            }
            for (const id of removedMessageIds) {
              draft.errorMap.delete(id)
            }
          })
        })
      },

      updateMessage: (sessionId, messageId, updater, change) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages) {
            return state
          }

          const idx = messages.findIndex(m => m.id === messageId)
          if (idx === -1) {
            return state
          }

          const currentMessage = messages[idx]
          const updatedMessage = reconcileMessage(currentMessage, updater(currentMessage), change)
          if (updatedMessage === currentMessage) {
            return state
          }

          return produce(state, (draft) => {
            draft.messagesMap.get(sessionId)![idx] = updatedMessage as Draft<UIMessage>
            if (updatedMessage.id !== messageId) {
              migrateAssistantDisplaySplitDraft(draft, messageId, updatedMessage.id)
            }
          })
        })
      },

      appendMessage: (sessionId, message) => {
        set((state) => {
          return produce(state, (draft) => {
            const messages = draft.messagesMap.get(sessionId)
            if (messages) {
              messages.push(message as Draft<UIMessage>)
            }
            else {
              draft.messagesMap.set(sessionId, [message as Draft<UIMessage>])
            }
          })
        })
      },

      insertLiveSteerMessage: (sessionId, message, sourceMessageId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId)
          if (!messages) {
            return state
          }
          const queueItemId = readContinuationQueueItemId(message)
          if (messages.some(current => current.id === message.id || (queueItemId !== null && readContinuationQueueItemId(current) === queueItemId))) {
            return state
          }

          const effectiveSourceMessageId = sourceMessageId ?? findActiveAssistantMessageId(state, sessionId)
          const sourceIndex = effectiveSourceMessageId
            ? messages.findIndex(current => current.id === effectiveSourceMessageId && current.role === 'assistant')
            : -1
          if (sourceIndex === -1) {
            return produce(state, (draft) => {
              draft.messagesMap.get(sessionId)!.push(message as Draft<UIMessage>)
            })
          }

          const sourceMessage = messages[sourceIndex]
          const split = state.assistantDisplaySplitMap.get(sourceMessage.id)
          const tailMessageId = split?.tailMessageId ?? `${sourceMessage.id}:steer-tail`
          const sourceHead = trimTrailingEmptyParts(split ? sourceMessage.parts : cloneMessageParts(sourceMessage.parts))
          const tailMessage = projectAssistantTailMessage(sourceMessage, sourceHead, tailMessageId)
          const shouldKeepTailPlaceholder = state.generatingMessageIds.has(sourceMessage.id)
            || state.passiveStreamingMessageIds.has(sourceMessage.id)
            || state.sessionMetaMap.get(sessionId)?.localDriverMessageId === sourceMessage.id
          const insertedMessageIds = split ? [...split.insertedMessageIds, message.id] : [message.id]
          const insertedQueueItemIds = queueItemId
            ? split
              ? [...split.insertedQueueItemIds.filter(id => id !== queueItemId), queueItemId]
              : [queueItemId]
            : split?.insertedQueueItemIds ?? []
          const nextMessages = [
            ...messages.slice(0, sourceIndex),
            { ...sourceMessage, parts: sourceHead },
            message,
            ...(shouldKeepTailPlaceholder || hasVisibleMessageParts(tailMessage.parts) ? [tailMessage] : []),
            ...messages.slice(sourceIndex + 1).filter(current => current.id !== tailMessageId),
          ]
          const currentMessageIds = new Set(messages.map(current => current.id))
          const nextMessageIds = new Set(nextMessages.map(current => current.id))
          const removedMessageIds = [...currentMessageIds].filter(id => !nextMessageIds.has(id))

          return produce(state, (draft) => {
            draft.messagesMap.set(sessionId, nextMessages as Draft<UIMessage[]>)
            draft.assistantDisplaySplitMap.set(sourceMessage.id, {
              sourceMessageId: sourceMessage.id,
              tailMessageId,
              splitParts: cloneMessageParts(sourceHead),
              insertedMessageIds,
              insertedQueueItemIds,
            } as Draft<AssistantDisplaySplit>)
            if (shouldKeepTailPlaceholder) {
              moveStreamingMessageDraft(draft, state, sessionId, sourceMessage.id, tailMessageId)
            }
            for (const removedMessageId of removedMessageIds) {
              draft.errorMap.delete(removedMessageId)
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

      // --- Streaming ---

      startGeneration: (sessionId, messageId, controller) => {
        set(state => produce(state, (draft) => {
          for (const message of state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES) {
            draft.errorMap.delete(message.id)
          }
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
        set(state => produce(state, (draft) => {
          const messageIds = readTerminalMessageIdsForRun(state, messageId)
          for (const currentMessageId of messageIds) {
            draft.generatingMessageIds.delete(currentMessageId)
            draft.passiveStreamingMessageIds.delete(currentMessageId)
            draft.activeAbortControllers.delete(currentMessageId)
            const currentRunMeta = draft.runDisplayMetaMap.get(currentMessageId)
            if (currentRunMeta && currentRunMeta.completedAtMs === null) {
              currentRunMeta.completedAtMs = performance.now()
            }
          }
          for (const [, meta] of draft.sessionMetaMap) {
            if (meta.localDriverMessageId && messageIds.includes(meta.localDriverMessageId)) {
              meta.cancelling = false
              meta.locallyDriving = false
              meta.localDriverMessageId = undefined
            }
          }
        }))
      },

      failGeneration: (messageId, error) => {
        set(state => produce(state, (draft) => {
          const messageIds = readTerminalMessageIdsForRun(state, messageId)
          const visibleMessageId = messageIds.at(-1) ?? messageId
          for (const currentMessageId of messageIds) {
            draft.generatingMessageIds.delete(currentMessageId)
            draft.passiveStreamingMessageIds.delete(currentMessageId)
            draft.activeAbortControllers.delete(currentMessageId)
            const currentRunMeta = draft.runDisplayMetaMap.get(currentMessageId)
            if (currentRunMeta && currentRunMeta.completedAtMs === null) {
              currentRunMeta.completedAtMs = performance.now()
            }
          }
          draft.errorMap.set(visibleMessageId, { message: error, timestamp: Date.now() })
          for (const [, meta] of draft.sessionMetaMap) {
            if (meta.localDriverMessageId && messageIds.includes(meta.localDriverMessageId)) {
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

      moveStreamingMessage: (sessionId, fromMessageId, toMessageId) => {
        if (fromMessageId === toMessageId) {
          return
        }
        set(state => produce(state, (draft) => {
          moveStreamingMessageDraft(draft, state, sessionId, fromMessageId, toMessageId)
        }))
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

      projectStreamingMessageForDisplay: (_sessionId, message) => {
        const state = get()
        return projectStreamingMessageThroughSplits(message, state.assistantDisplaySplitMap, new Set())
      },

      // --- Session Meta ---

      setSessionMeta: (sessionId, meta) => {
        set(state => produce(state, (draft) => {
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

      setSessionHydrated: (sessionId, hydrated) => {
        set((state) => {
          if (state.hydratedSessionIds.has(sessionId) === hydrated) {
            return state
          }
          return produce(state, (draft) => {
            if (hydrated) {
              draft.hydratedSessionIds.add(sessionId)
            }
            else {
              draft.hydratedSessionIds.delete(sessionId)
            }
          })
        })
      },

      setActiveGoal: (sessionId, input) => {
        const objective = input.objective.trim()
        if (!objective) {
          return
        }
        set((state) => {
          const now = Math.floor(Date.now() / 1000)
          const current = state.activeGoalMap.get(sessionId)
          const next: ChatActiveGoal = {
            sessionId,
            objective,
            status: input.status ?? 'active',
            sourceMessageId: input.sourceMessageId ?? null,
            tokenBudget: input.tokenBudget ?? null,
            tokensUsed: current?.tokensUsed ?? 0,
            timeUsedSeconds: current?.timeUsedSeconds ?? 0,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          }
          if (areActiveGoalsEqual(current, next)) {
            return state
          }
          return produce(state, (draft) => {
            draft.activeGoalMap.set(sessionId, next as Draft<ChatActiveGoal>)
          })
        })
      },

      clearActiveGoal: (sessionId) => {
        set((state) => {
          if (!state.activeGoalMap.has(sessionId)) {
            return state
          }
          return produce(state, (draft) => {
            draft.activeGoalMap.delete(sessionId)
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
            draft.hydratedSessionIds.delete(sessionId)
            draft.sessionMetaMap.delete(sessionId)
            draft.activeGoalMap.delete(sessionId)
            for (const message of removedMessages) {
              draft.runDisplayMetaMap.delete(message.id)
              draft.errorMap.delete(message.id)
            }
            for (const id of removedMessageIds) {
              draft.passiveStreamingMessageIds.delete(id)
            }
          })
        })
      },

      clearError: (messageId) => {
        set(state => produce(state, (draft) => {
          draft.errorMap.delete(messageId)
        }))
      },

      clearSessionErrors: (sessionId) => {
        set((state) => {
          const messages = state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
          if (!messages.some(message => state.errorMap.has(message.id))) {
            return state
          }

          return produce(state, (draft) => {
            for (const message of messages) {
              draft.errorMap.delete(message.id)
            }
          })
        })
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

  /** Streaming state for the rendered bubble, including pre-SSE local driver ownership. */
  isVisibleStreamingMessage: (sessionId: string, messageId: string) => (s: ChatState) => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    return s.generatingMessageIds.has(messageId)
      || s.passiveStreamingMessageIds.has(messageId)
      || meta.localDriverMessageId === messageId
  },

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

  /** Session-level: is this session visibly streaming in any renderer. */
  isSessionStreaming: (sessionId: string) => (s: ChatState) => {
    const meta = s.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    if (meta.locallyDriving || meta.passiveStatus === 'streaming') {
      return true
    }
    const messages = s.messagesMap.get(sessionId)
    if (!messages) {
      return false
    }
    return messages.some(message => s.generatingMessageIds.has(message.id) || s.passiveStreamingMessageIds.has(message.id))
  },

  /** Error for a message */
  error: (messageId: string) => (s: ChatState) =>
    s.errorMap.get(messageId),

  /** Most recent error for a session */
  latestError: (sessionId: string) => (s: ChatState) => {
    const messages = s.messagesMap.get(sessionId)
    if (!messages) {
      return undefined
    }
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

  activeGoal: (sessionId: string) => (s: ChatState) =>
    s.activeGoalMap.get(sessionId) ?? null,

  isSessionHydrated: (sessionId: string) => (s: ChatState) =>
    s.hydratedSessionIds.has(sessionId),

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

  runDisplayMeta: (messageId: string) => (s: ChatState) =>
    s.runDisplayMetaMap.get(messageId),
}

function moveStreamingMessageDraft(
  draft: Draft<ChatState>,
  state: ChatState,
  sessionId: string,
  fromMessageId: string,
  toMessageId: string,
): void {
  if (fromMessageId === toMessageId) {
    return
  }

  const wasGenerating = state.generatingMessageIds.has(fromMessageId)
  const wasPassiveStreaming = state.passiveStreamingMessageIds.has(fromMessageId)
  const controller = state.activeAbortControllers.get(fromMessageId)
  const runMeta = state.runDisplayMetaMap.get(fromMessageId)

  draft.generatingMessageIds.delete(fromMessageId)
  draft.passiveStreamingMessageIds.delete(fromMessageId)
  draft.activeAbortControllers.delete(fromMessageId)
  draft.runDisplayMetaMap.delete(fromMessageId)

  if (wasGenerating) {
    draft.generatingMessageIds.add(toMessageId)
  }
  if (wasPassiveStreaming) {
    draft.passiveStreamingMessageIds.add(toMessageId)
  }
  if (controller) {
    draft.activeAbortControllers.set(toMessageId, controller)
  }
  if (runMeta && !state.runDisplayMetaMap.has(toMessageId)) {
    draft.runDisplayMetaMap.set(toMessageId, { ...runMeta } as Draft<ChatRunDisplayMeta>)
  }

  const current = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
  if (current.localDriverMessageId === fromMessageId) {
    draft.sessionMetaMap.set(sessionId, {
      ...current,
      localDriverMessageId: toMessageId,
    })
  }
}

function readTerminalMessageIdsForRun(state: ChatState, messageId: string): string[] {
  const split = state.assistantDisplaySplitMap.get(messageId)
  return split ? [messageId, split.tailMessageId] : [messageId]
}

function migrateAssistantDisplaySplitDraft(
  draft: Draft<ChatState>,
  fromMessageId: string,
  toMessageId: string,
): void {
  if (fromMessageId === toMessageId) {
    return
  }

  const split = draft.assistantDisplaySplitMap.get(fromMessageId)
  if (!split) {
    return
  }

  const nextTailMessageId = `${toMessageId}:steer-tail`
  const sessionId = findSessionIdForMessageDraft(draft, split.tailMessageId)
  draft.assistantDisplaySplitMap.delete(fromMessageId)
  if (!draft.assistantDisplaySplitMap.has(toMessageId)) {
    draft.assistantDisplaySplitMap.set(toMessageId, {
      ...split,
      sourceMessageId: toMessageId,
      tailMessageId: nextTailMessageId,
    } as Draft<AssistantDisplaySplit>)
  }
  if (sessionId) {
    const messages = draft.messagesMap.get(sessionId)
    const tailMessage = messages?.find(message => message.id === split.tailMessageId)
    if (tailMessage) {
      tailMessage.id = nextTailMessageId
    }
    if (draft.generatingMessageIds.delete(split.tailMessageId)) {
      draft.generatingMessageIds.add(nextTailMessageId)
    }
    if (draft.passiveStreamingMessageIds.delete(split.tailMessageId)) {
      draft.passiveStreamingMessageIds.add(nextTailMessageId)
    }
    const controller = draft.activeAbortControllers.get(split.tailMessageId)
    if (controller) {
      draft.activeAbortControllers.delete(split.tailMessageId)
      draft.activeAbortControllers.set(nextTailMessageId, controller)
    }
    const runMeta = draft.runDisplayMetaMap.get(split.tailMessageId)
    if (runMeta) {
      draft.runDisplayMetaMap.delete(split.tailMessageId)
      draft.runDisplayMetaMap.set(nextTailMessageId, runMeta)
    }
    const current = draft.sessionMetaMap.get(sessionId) ?? DEFAULT_SESSION_META
    if (current.localDriverMessageId === split.tailMessageId) {
      draft.sessionMetaMap.set(sessionId, {
        ...current,
        localDriverMessageId: nextTailMessageId,
      })
    }
  }
}

function findSessionIdForMessageDraft(
  draft: Draft<ChatState>,
  messageId: string,
): string | null {
  for (const [sessionId, messages] of draft.messagesMap) {
    if (messages.some(message => message.id === messageId)) {
      return sessionId
    }
  }
  return null
}

function reconcileMessages(currentMessages: UIMessage[], incomingMessages: UIMessage[]): UIMessage[] {
  if (currentMessages === incomingMessages) {
    return currentMessages
  }

  let hasChanges = false
  const currentMessagesById = currentMessages.length === incomingMessages.length
    ? null
    : new Map(currentMessages.map(message => [message.id, message]))
  const nextMessages = incomingMessages.map((incomingMessage, index) => {
    const currentMessage = currentMessages[index]?.id === incomingMessage.id
      ? currentMessages[index]
      : currentMessagesById?.get(incomingMessage.id)
    if (!currentMessage) {
      hasChanges = true
      return incomingMessage
    }
    const nextMessage = reconcileMessage(currentMessage, incomingMessage)
    if (nextMessage === currentMessage) {
      return currentMessage
    }
    hasChanges = true
    return nextMessage
  })

  return hasChanges ? nextMessages : currentMessages
}

function reconcileMessage(
  currentMessage: UIMessage,
  incomingMessage: UIMessage,
  change?: MessageReconcileChange,
): UIMessage {
  if (currentMessage === incomingMessage) {
    return currentMessage
  }
  if (currentMessage.id !== incomingMessage.id || currentMessage.role !== incomingMessage.role) {
    return incomingMessage
  }

  const currentMetadata = (currentMessage as { metadata?: unknown }).metadata
  const incomingMetadata = (incomingMessage as { metadata?: unknown }).metadata
  const metadata = isEqual(currentMetadata, incomingMetadata)
    ? currentMetadata
    : incomingMetadata
  const parts = reconcileMessageParts(currentMessage.parts, incomingMessage.parts, change)

  if (metadata === currentMetadata && parts === currentMessage.parts) {
    return currentMessage
  }

  return {
    ...incomingMessage,
    ...(metadata === undefined ? {} : { metadata }),
    parts,
  } as UIMessage
}

function reconcileMessageParts(
  currentParts: MessagePart[],
  incomingParts: MessagePart[],
  change?: MessageReconcileChange,
): MessagePart[] {
  if (currentParts === incomingParts) {
    return currentParts
  }

  let hasChanges = false
  const nextParts = incomingParts.map((incomingPart, index) => {
    const currentPart = currentParts[index]
    if (!currentPart) {
      hasChanges = true
      return incomingPart
    }
    if (canReuseMessagePart(currentPart, incomingPart, change)) {
      return currentPart
    }
    hasChanges = true
    return incomingPart
  })

  return hasChanges || currentParts.length !== incomingParts.length ? nextParts : currentParts
}

function canReuseMessagePart(
  currentPart: MessagePart,
  incomingPart: MessagePart,
  change?: MessageReconcileChange,
): boolean {
  if (currentPart === incomingPart) {
    return true
  }
  if (currentPart.type !== incomingPart.type) {
    return false
  }

  if (isToolMessagePart(currentPart) && isToolMessagePart(incomingPart)) {
    const currentToolCallId = readToolCallId(currentPart)
    if (!currentToolCallId || currentToolCallId !== readToolCallId(incomingPart)) {
      return false
    }
    if (change?.dirtyToolCallIds && !change.dirtyToolCallIds.has(currentToolCallId)) {
      return true
    }
    return isEqual(currentPart, incomingPart)
  }

  return areMessagePartsStructurallyEqual(currentPart, incomingPart)
}

interface PersistedAssistantDisplaySplit {
  message: UIMessage
  queueItemId: string | null
  sourceMessageId: string
  splitParts: UIMessage['parts']
  order: number
}

function hydrateAssistantDisplaySplits(
  messages: UIMessage[],
  currentSplits: Map<string, AssistantDisplaySplit>,
): Map<string, AssistantDisplaySplit> {
  const groups = new Map<string, PersistedAssistantDisplaySplit[]>()
  for (let order = 0; order < messages.length; order += 1) {
    const message = messages[order]
    if (message.role !== 'user') {
      continue
    }
    const split = readPersistedAssistantDisplaySplit(message, order)
    if (!split) {
      continue
    }
    const existing = groups.get(split.sourceMessageId)
    if (existing) {
      existing.push(split)
    }
    else {
      groups.set(split.sourceMessageId, [split])
    }
  }

  if (groups.size === 0) {
    return currentSplits
  }

  let nextSplits: Map<string, AssistantDisplaySplit> | null = null
  const writableSplits = () => {
    nextSplits ??= new Map(currentSplits)
    return nextSplits
  }

  for (const [sourceMessageId, splits] of groups) {
    let currentSourceMessageId = sourceMessageId
    let previousPersistedSplitParts: UIMessage['parts'] | null = null

    for (const split of splits.toSorted((left, right) => left.order - right.order)) {
      const relativeSplitParts = previousPersistedSplitParts
        ? projectTailParts(split.splitParts, previousPersistedSplitParts)
        : split.splitParts
      const tailMessageId = `${currentSourceMessageId}:steer-tail`
      const existing = writableSplits().get(currentSourceMessageId)
      const insertedMessageIds = pushUnique(existing?.insertedMessageIds ?? [], split.message.id)
      const insertedQueueItemIds = split.queueItemId
        ? pushUnique(existing?.insertedQueueItemIds ?? [], split.queueItemId)
        : existing?.insertedQueueItemIds ?? []

      writableSplits().set(currentSourceMessageId, {
        sourceMessageId: currentSourceMessageId,
        tailMessageId,
        splitParts: trimTrailingEmptyParts(cloneMessageParts(relativeSplitParts)),
        insertedMessageIds,
        insertedQueueItemIds,
      })

      previousPersistedSplitParts = split.splitParts
      currentSourceMessageId = tailMessageId
    }
  }

  return nextSplits ?? currentSplits
}

function readPersistedAssistantDisplaySplit(message: UIMessage, order: number): PersistedAssistantDisplaySplit | null {
  const metadata = readRecordValue((message as { metadata?: unknown }).metadata)
  const cradle = readRecordValue(metadata?.cradle)
  const continuation = readRecordValue(cradle?.continuation)
  if (continuation?.mode !== 'steer') {
    return null
  }
  const sourceMessageId = continuation.sourceMessageId
  if (typeof sourceMessageId !== 'string' || sourceMessageId.length === 0) {
    return null
  }
  const splitParts = readPersistedSplitParts(continuation.splitParts)
  if (!splitParts) {
    return null
  }

  return {
    message,
    queueItemId: readContinuationQueueItemId(message),
    sourceMessageId,
    splitParts,
    order,
  }
}

function readPersistedSplitParts(value: unknown): UIMessage['parts'] | null {
  if (
    !Array.isArray(value)
    || !value.every(part => typeof part === 'object' && part !== null && !Array.isArray(part) && typeof (part as { type?: unknown }).type === 'string')
  ) {
    return null
  }
  return value as UIMessage['parts']
}

function pushUnique(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue]
}

function applyAssistantDisplaySplits(
  messages: UIMessage[],
  splits: Map<string, AssistantDisplaySplit>,
): UIMessage[] {
  if (splits.size === 0) {
    return messages
  }
  const splitSourceIds = new Set([...splits.keys()])
  const insertedMessageIds = new Set([...splits.values()].flatMap(split => split.insertedMessageIds))
  const insertedQueueItemIds = new Set([...splits.values()].flatMap(split => split.insertedQueueItemIds))
  const sourceMessages = new Map(messages.filter(message => splitSourceIds.has(message.id)).map(message => [message.id, message]))
  const result: UIMessage[] = []

  for (const message of messages) {
    if (message.id.includes(':steer-tail')) {
      continue
    }
    const queueItemId = readContinuationQueueItemId(message)
    if (insertedMessageIds.has(message.id) || (queueItemId !== null && insertedQueueItemIds.has(queueItemId))) {
      const sourceIndex = findSplitSourceIndexForInsertedMessage(result, splits, message)
      if (sourceIndex !== -1) {
        const sourceMessage = result[sourceIndex]
        const split = splits.get(sourceMessage.id)
        if (split) {
          const fullSourceMessage = sourceMessages.get(sourceMessage.id) ?? sourceMessage
          const tailMessage = projectAssistantTailMessage(fullSourceMessage, split.splitParts, split.tailMessageId)
          const nextMessages = hasVisibleMessageParts(tailMessage.parts)
            ? [message, tailMessage]
            : [message]
          result.splice(sourceIndex + 1, 0, ...nextMessages)
          continue
        }
      }
    }
    if (splitSourceIds.has(message.id)) {
      const split = splits.get(message.id)
      result.push(split ? { ...message, parts: cloneMessageParts(split.splitParts) } : message)
      continue
    }
    result.push(message)
  }

  return result
}

function findSplitSourceIndexForInsertedMessage(
  messages: UIMessage[],
  splits: Map<string, AssistantDisplaySplit>,
  insertedMessage: UIMessage,
): number {
  const queueItemId = readContinuationQueueItemId(insertedMessage)
  for (let index = messages.length - 1; index >= 0; index--) {
    const split = splits.get(messages[index].id)
    if (
      split?.insertedMessageIds.includes(insertedMessage.id)
      || (queueItemId !== null && split?.insertedQueueItemIds.includes(queueItemId))
    ) {
      return index
    }
  }
  return -1
}

function readContinuationQueueItemId(message: UIMessage): string | null {
  const metadata = readRecordValue((message as { metadata?: unknown }).metadata)
  const cradle = readRecordValue(metadata?.cradle)
  const continuation = readRecordValue(cradle?.continuation)
  const queueItemId = continuation?.queueItemId
  return typeof queueItemId === 'string' && queueItemId.length > 0 ? queueItemId : null
}

function findActiveAssistantMessageId(state: ChatState, sessionId: string): string | null {
  const messages = state.messagesMap.get(sessionId) ?? EMPTY_MESSAGES
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (
      message.role === 'assistant'
      && (
        state.generatingMessageIds.has(message.id)
        || state.passiveStreamingMessageIds.has(message.id)
        || state.sessionMetaMap.get(sessionId)?.localDriverMessageId === message.id
      )
    ) {
      return message.id
    }
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'assistant') {
      return message.id
    }
  }
  return null
}

function cloneMessageParts(parts: UIMessage['parts']): UIMessage['parts'] {
  return structuredClone(parts) as UIMessage['parts']
}

function trimTrailingEmptyParts(parts: UIMessage['parts']): UIMessage['parts'] {
  const nextParts = [...parts]
  while (nextParts.length > 0 && isEmptyDisplayPart(nextParts.at(-1)!)) {
    nextParts.pop()
  }
  return nextParts
}

function isEmptyDisplayPart(part: MessagePart): boolean {
  if (part.type === 'text') {
    return part.text.length === 0
  }
  if (part.type === 'reasoning') {
    const value = readReasoningPart(part).text ?? readReasoningPart(part).reasoning
    return !value
  }
  return false
}

function hasVisibleMessageParts(parts: UIMessage['parts']): boolean {
  return parts.some(part => !isEmptyDisplayPart(part))
}

function projectAssistantTailMessage(
  sourceMessage: UIMessage,
  splitParts: UIMessage['parts'],
  tailMessageId: string,
): UIMessage {
  return {
    ...sourceMessage,
    id: tailMessageId,
    parts: projectTailParts(sourceMessage.parts, splitParts),
  }
}

function projectStreamingMessageThroughSplits(
  message: UIMessage,
  splits: Map<string, AssistantDisplaySplit>,
  seenMessageIds: Set<string>,
): UIMessage {
  const split = splits.get(message.id)
  if (!split || seenMessageIds.has(message.id)) {
    return message
  }
  seenMessageIds.add(message.id)
  return projectStreamingMessageThroughSplits(
    projectAssistantTailMessage(message, split.splitParts, split.tailMessageId),
    splits,
    seenMessageIds,
  )
}

function projectTailParts(sourceParts: UIMessage['parts'], splitParts: UIMessage['parts']): UIMessage['parts'] {
  const tailParts: UIMessage['parts'] = []
  let sourceIndex = 0

  for (let splitIndex = 0; splitIndex < splitParts.length; splitIndex++) {
    const splitPart = splitParts[splitIndex]
    const sourcePart = sourceParts[sourceIndex]
    if (!sourcePart) {
      return tailParts
    }
    if (!areSameStreamPart(sourcePart, splitPart)) {
      break
    }

    const remainder = projectPartRemainder(sourcePart, splitPart)
    if (remainder) {
      tailParts.push(remainder)
      tailParts.push(...cloneMessageParts(sourceParts.slice(sourceIndex + 1)))
      return trimLeadingEmptyParts(tailParts)
    }
    sourceIndex += 1
  }

  tailParts.push(...cloneMessageParts(sourceParts.slice(sourceIndex)))
  return trimLeadingEmptyParts(tailParts)
}

function trimLeadingEmptyParts(parts: UIMessage['parts']): UIMessage['parts'] {
  const nextParts = [...parts]
  while (nextParts.length > 0 && isEmptyDisplayPart(nextParts[0])) {
    nextParts.shift()
  }
  return nextParts
}

function areSameStreamPart(sourcePart: MessagePart, splitPart: MessagePart): boolean {
  if (sourcePart.type !== splitPart.type) {
    return false
  }
  if (sourcePart.type === 'dynamic-tool' || sourcePart.type.startsWith('tool-')) {
    return readToolCallId(sourcePart) === readToolCallId(splitPart)
  }
  return true
}

function projectPartRemainder(sourcePart: MessagePart, splitPart: MessagePart): MessagePart | null {
  if (sourcePart.type === 'text' && splitPart.type === 'text') {
    const remainder = slicePrefix(sourcePart.text, splitPart.text)
    return remainder ? { ...sourcePart, text: remainder } : null
  }
  if (sourcePart.type === 'reasoning' && splitPart.type === 'reasoning') {
    const sourceReasoning = readReasoningPart(sourcePart)
    const splitReasoning = readReasoningPart(splitPart)
    const sourceText = sourceReasoning.text ?? sourceReasoning.reasoning ?? ''
    const splitText = splitReasoning.text ?? splitReasoning.reasoning ?? ''
    const remainder = slicePrefix(sourceText, splitText)
    if (!remainder) {
      return null
    }
    return sourceReasoning.text !== undefined
      ? { ...sourcePart, text: remainder }
      : { ...sourcePart, reasoning: remainder } as MessagePart
  }
  return null
}

function slicePrefix(sourceText: string, prefixText: string): string {
  return sourceText.startsWith(prefixText) ? sourceText.slice(prefixText.length) : sourceText
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
    case 'dynamic-tool':
      return false
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readRecordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && !Array.isArray(value) ? value : null
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

function readToolCallId(part: MessagePart): string | undefined {
  const record = isRecord(part) ? part as Record<string, unknown> : {}
  return typeof record.toolCallId === 'string' ? record.toolCallId : undefined
}

function isToolMessagePart(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function areActiveGoalsEqual(left: ChatActiveGoal | undefined, right: ChatActiveGoal): boolean {
  return left !== undefined
    && left.sessionId === right.sessionId
    && left.objective === right.objective
    && left.status === right.status
    && left.sourceMessageId === right.sourceMessageId
    && left.tokenBudget === right.tokenBudget
    && left.tokensUsed === right.tokensUsed
    && left.timeUsedSeconds === right.timeUsedSeconds
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
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
