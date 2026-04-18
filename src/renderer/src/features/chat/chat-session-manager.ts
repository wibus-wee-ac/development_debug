// Input: zustand, AI SDK readUIMessageStream + UIMessage/UIMessageChunk types, ipc
// Output: ChatSessionManager — protocol-driven singleton managing all chat sessions
// Position: Core service layer for chat feature, independent of UI lifecycle

import {
  getAcpSessionState,
  setAcpSessionConfigOption,
  setAcpSessionModel
} from '@renderer/features/workspace/use-acp-session-state'
import { ipc } from '@renderer/lib/ipc'
import { applyStoredChatPreferences } from '@shared/chat-preferences'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'
import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Seconds before we consider the stream stalled with no first chunk. */
const FIRST_CHUNK_TIMEOUT_MS = 15_000

interface ManagedSession {
  /** Stable product-layer chat session ID (UUID, key in the sessions map). */
  sessionId: string
  /** Active ACP transport session ID. Null when no live connection (historical). */
  acpSessionId: string | null
  agentId: string
  workspaceId: string
  /** Model ID snapshot from DB — shown when no active ACP session. */
  modelId: string | null
  /** Config snapshot from DB — shown when no active ACP session. */
  configSnapshot: string | null
  messages: UIMessage[]
  status: 'idle' | 'streaming' | 'error' | 'failed_to_start'
  error?: string
}

interface ChatSessionManagerState {
  sessions: Record<string, ManagedSession>

  /**
   * Create ACP + DB sessions, send first prompt, start background stream.
   * Returns the stable chat session ID (not the ACP session ID).
   */
  createAndSend: (opts: {
    agentId: string
    workspaceId: string
    cwd: string
    text: string
  }) => Promise<string>

  /** Send a follow-up message. Reconnects ACP session automatically if needed. */
  sendMessage: (sessionId: string, text: string, cwd?: string) => Promise<void>

  /** Ensure a chat session has an active ACP transport session, reconnecting if needed. */
  ensureLiveSession: (sessionId: string) => Promise<string>

  /** Load session + messages from DB (idempotent). */
  loadSession: (sessionId: string) => Promise<void>

  /** Cancel an in-progress prompt. */
  stop: (sessionId: string) => void
}

// ── Serialize / deserialize for DB persistence ────────────────────────────────

function serializeMessage(msg: UIMessage): string {
  return JSON.stringify({ id: msg.id, role: msg.role, parts: msg.parts })
}

function deserializeMessage(content: string, fallbackRole: 'user' | 'assistant'): UIMessage {
  try {
    const parsed = JSON.parse(content) as { id?: string; role?: string; parts?: unknown[] }
    if (parsed.parts && Array.isArray(parsed.parts)) {
      return {
        id: parsed.id ?? crypto.randomUUID(),
        role: (parsed.role as UIMessage['role']) ?? fallbackRole,
        parts: parsed.parts as UIMessage['parts']
      }
    }
  } catch {
    // Fall through
  }
  return {
    id: crypto.randomUUID(),
    role: fallbackRole,
    parts: [{ type: 'text', text: content }]
  }
}

// ── IPC stream → ReadableStream<UIMessageChunk> adapter ───────────────────────

/**
 * Creates a ReadableStream that bridges Electron IPC events for a specific
 * ACP session into AI SDK UIMessageChunk objects.
 *
 * @param acpSessionId - The ACP transport session ID (matches main process event data)
 * @param abortSignal  - Abort triggers cancelPrompt + stream close
 * @param agentId      - Used for cancelPrompt on abort
 */
function createIpcChunkStream(
  acpSessionId: string,
  abortSignal: AbortSignal,
  agentId: string
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      const cleanupChunk = window.electron.ipcRenderer.on(
        'acp:session-chunk',
        (_event: unknown, data: { sessionId: string; chunk: UIMessageChunk }) => {
          if (data.sessionId !== acpSessionId) {
            return
          }
          controller.enqueue(data.chunk)
        }
      )

      const cleanupDone = window.electron.ipcRenderer.on(
        'acp:session-done',
        (_event: unknown, data: { sessionId: string }) => {
          if (data.sessionId !== acpSessionId) {
            return
          }
          cleanup()
          controller.close()
        }
      )

      const cleanupError = window.electron.ipcRenderer.on(
        'acp:session-error',
        (_event: unknown, data: { sessionId: string; error: string }) => {
          if (data.sessionId !== acpSessionId) {
            return
          }
          cleanup()
          controller.error(new Error(data.error))
        }
      )

      function cleanup() {
        cleanupChunk()
        cleanupDone()
        cleanupError()
      }

      abortSignal.addEventListener('abort', () => {
        cleanup()
        ipc?.acp.cancelPrompt(agentId, acpSessionId).catch(() => {})
        controller.close()
      })
    }
  })
}

// ── The store ─────────────────────────────────────────────────────────────────

// Track abort controllers outside zustand (keyed by chatSessionId)
const abortControllers = new Map<string, AbortController>()

export const useChatSessionManager = create<ChatSessionManagerState>((set, get) => {
  // ── Internal: process stream, track by stable messageId, persist in finally ─

  async function processStream(
    sessionId: string,
    stream: ReadableStream<UIMessageChunk>,
    ac: AbortController
  ) {
    const assistantMsgId = crypto.randomUUID()
    let firstChunkReceived = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    // First-chunk timeout: abort if no chunk arrives within FIRST_CHUNK_TIMEOUT_MS
    timeoutId = setTimeout(() => {
      if (!firstChunkReceived) {
        ac.abort()
        set((s) => ({
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...s.sessions[sessionId],
              status: 'failed_to_start',
              error: `Agent did not respond within ${FIRST_CHUNK_TIMEOUT_MS / 1000}s`
            }
          }
        }))
      }
    }, FIRST_CHUNK_TIMEOUT_MS)

    try {
      const messageStream = readUIMessageStream({
        message: { id: assistantMsgId, role: 'assistant', parts: [] } as UIMessage,
        stream
      })

      for await (const messageSnapshot of messageStream) {
        if (!firstChunkReceived) {
          firstChunkReceived = true
          if (timeoutId !== null) {
            clearTimeout(timeoutId)
            timeoutId = null
          }
        }

        set((s) => {
          const session = s.sessions[sessionId]
          if (!session) {
            return s
          }
          const msgs = [...session.messages]
          const idx = msgs.findIndex((m) => m.id === messageSnapshot.id)
          if (idx >= 0) {
            msgs[idx] = messageSnapshot
          } else {
            msgs.push(messageSnapshot)
          }
          return {
            sessions: {
              ...s.sessions,
              [sessionId]: { ...session, messages: msgs, status: 'streaming' }
            }
          }
        })
      }

      // Stream finished normally
      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], status: 'idle' }
        }
      }))
    } catch (err) {
      // Only update error if not already marked failed_to_start by the timeout
      set((s) => {
        const cur = s.sessions[sessionId]
        if (!cur || cur.status === 'failed_to_start') {
          return s
        }
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...cur,
              status: 'error',
              error: err instanceof Error ? err.message : String(err)
            }
          }
        }
      })
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
      // Persist whatever partial / complete content exists (covers abort + error + normal)
      const currentSession = get().sessions[sessionId]
      const assistantMsg = currentSession?.messages.find((m) => m.id === assistantMsgId)
      if (assistantMsg && assistantMsg.parts.length > 0) {
        await ipc?.session
          .addMessage({
            sessionId,
            role: 'assistant',
            content: serializeMessage(assistantMsg)
          })
          .catch(() => {})
      }
      abortControllers.delete(sessionId)
    }
  }

  // ── Internal: subscribe to IPC stream and fire prompt ────────────────────

  async function firePrompt(
    chatSessionId: string,
    acpSessionId: string,
    agentId: string,
    text: string
  ) {
    const ac = new AbortController()
    abortControllers.set(chatSessionId, ac)

    // Subscribe to IPC events BEFORE sending the prompt (no missed chunks)
    const stream = createIpcChunkStream(acpSessionId, ac.signal, agentId)

    // Fire the prompt — main process executes and streams back via IPC events
    ipc?.acp.sendPrompt(agentId, acpSessionId, text).catch((err: unknown) => {
      set((s) => ({
        sessions: {
          ...s.sessions,
          [chatSessionId]: {
            ...s.sessions[chatSessionId],
            status: 'error',
            error: err instanceof Error ? err.message : String(err)
          }
        }
      }))
    })

    // Process stream asynchronously — doesn't block the caller
    processStream(chatSessionId, stream, ac)
  }

  async function ensureLiveSessionInternal(sessionId: string): Promise<string> {
    if (!ipc) {
      throw new Error('IPC not available')
    }

    const session = get().sessions[sessionId]
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (session.acpSessionId) {
      const existingState = await getAcpSessionState(session.agentId, session.acpSessionId).catch(
        () => null
      )
      if (existingState) {
        return session.acpSessionId
      }
    }

    const workspace = await ipc.workspace.get(session.workspaceId)
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available for ACP reconnect.')
    }

    const isRunning = await ipc.acp.isAgentRunning(session.agentId)
    if (!isRunning) {
      await ipc.acp.startAgent(session.agentId)
    }

    const resp = await ipc.acp.createSession(session.agentId, cwd)
    const acpSessionId = (resp as { sessionId: string } | undefined)?.sessionId ?? null
    if (!acpSessionId) {
      throw new Error('Failed to reconnect ACP session.')
    }

    set((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: { ...s.sessions[sessionId], acpSessionId }
      }
    }))

    return acpSessionId
  }

  return {
    sessions: {},

    async createAndSend({ agentId, workspaceId, cwd, text }) {
      if (!ipc) {
        throw new Error('IPC not available')
      }

      // 1. Ensure agent is running
      const isRunning = await ipc.acp.isAgentRunning(agentId)
      if (!isRunning) {
        await ipc.acp.startAgent(agentId)
      }

      // 2. Create ACP session — acpSessionId is the TRANSPORT-layer ID
      const resp = await ipc.acp.createSession(agentId, cwd)
      const acpSessionId = (resp as { sessionId: string }).sessionId

      // 3. Fetch initial session state to capture model/config snapshot
      let initialState = await getAcpSessionState(agentId, acpSessionId).catch(() => null)
      const preferences = await ipc.preferences.getChatPreferences().catch(() => null)

      await applyStoredChatPreferences({
        preferences,
        state: initialState,
        setModel: (modelId) => setAcpSessionModel(agentId, acpSessionId, modelId),
        setConfigOption: (configId, value) =>
          setAcpSessionConfigOption(agentId, acpSessionId, configId, value)
      })

      initialState = await getAcpSessionState(agentId, acpSessionId).catch(() => initialState)

      const modelId = initialState?.models?.currentModelId ?? null
      const configSnapshot = initialState?.configOptions
        ? JSON.stringify(initialState.configOptions)
        : null

      // 4. Generate stable chat session ID (product layer, independent of ACP)
      const chatSessionId = crypto.randomUUID()

      // 5. Persist DB session linking chatSessionId → acpSessionId
      const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text
      await ipc.session.create({
        id: chatSessionId,
        workspaceId,
        title: fallbackTitle,
        agent: agentId,
        acpSessionId,
        modelId: modelId ?? undefined,
        configSnapshot: configSnapshot ?? undefined
      })

      // 6. Persist user message
      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }]
      }
      await ipc.session.addMessage({
        sessionId: chatSessionId,
        role: 'user',
        content: serializeMessage(userMsg)
      })

      // 7. Initialize manager state
      set((s) => ({
        sessions: {
          ...s.sessions,
          [chatSessionId]: {
            sessionId: chatSessionId,
            acpSessionId,
            agentId,
            workspaceId,
            modelId,
            configSnapshot,
            messages: [userMsg],
            status: 'streaming'
          }
        }
      }))

      // 8. Fire prompt and process stream in background
      await firePrompt(chatSessionId, acpSessionId, agentId, text)

      return chatSessionId
    },

    async sendMessage(sessionId, text, cwd) {
      const session = get().sessions[sessionId]
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      let acpSessionId = session.acpSessionId

      // If no active ACP session, create a new one (reconnect)
      if (!acpSessionId && cwd) {
        const isRunning = await ipc?.acp.isAgentRunning(session.agentId)
        if (!isRunning) {
          await ipc?.acp.startAgent(session.agentId)
        }

        const resp = await ipc?.acp.createSession(session.agentId, cwd)
        acpSessionId = (resp as { sessionId: string } | undefined)?.sessionId ?? null
        if (acpSessionId) {
          set((s) => ({
            sessions: {
              ...s.sessions,
              [sessionId]: { ...s.sessions[sessionId], acpSessionId }
            }
          }))
        }
      }

      if (!acpSessionId) {
        throw new Error('No active ACP session. Provide cwd to reconnect.')
      }

      const userMsg: UIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }]
      }

      await ipc?.session.addMessage({
        sessionId,
        role: 'user',
        content: serializeMessage(userMsg)
      })

      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            acpSessionId,
            messages: [...session.messages, userMsg],
            status: 'streaming'
          }
        }
      }))

      await firePrompt(sessionId, acpSessionId, session.agentId, text)
    },

    async ensureLiveSession(sessionId) {
      return ensureLiveSessionInternal(sessionId)
    },

    async loadSession(sessionId) {
      if (!ipc) {
        return
      }

      // Idempotent — skip if already in memory
      if (get().sessions[sessionId]) {
        return
      }

      const dbSession = await ipc.session.get(sessionId)
      if (!dbSession) {
        return
      }

      const rows = await ipc.session.getMessages(sessionId)
      const messages: UIMessage[] = rows.map((row) =>
        deserializeMessage(row.content, row.role as 'user' | 'assistant')
      )

      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            sessionId,
            acpSessionId: dbSession.acpSessionId ?? null,
            agentId: dbSession.agent,
            workspaceId: dbSession.workspaceId,
            modelId: dbSession.modelId ?? null,
            configSnapshot: dbSession.configSnapshot ?? null,
            messages,
            status: 'idle'
          }
        }
      }))
    },

    stop(sessionId) {
      const ac = abortControllers.get(sessionId)
      if (ac) {
        ac.abort()
      }

      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], status: 'idle' }
        }
      }))
    }
  }
})
