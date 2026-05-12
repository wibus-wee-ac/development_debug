// Input: chatSessionId + server HTTP API
// Output: SseChatTransportHandle — ChatTransport backed by HTTP runs API + SSE streaming, plus server-side abort
// Position: apps/web/src/features/chat/sse-chat-transport.ts — web replacement for ipc-chat-transport

import { projectTimelineEventToChunks } from '@shared/timeline-projection'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { publish } from '~/lib/signal'

const SERVER_BASE: string = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'

export interface SseChatTransportHandle {
  transport: ChatTransport<UIMessage>
  abort: () => Promise<void>
}

/** Minimal shape of a StoredTimelineEvent as delivered by the SSE stream. */
type StoredEventShape = {
  type: string
  runId: string
  chatSessionId: string
  error?: string
  [key: string]: unknown
}

/** Minimal shape of a ChatTimelineGroup returned by the timeline endpoint. */
type TimelineGroupShape = {
  messageId: string
  role: string
  status: string
  events: Array<{ type: string, runId: string }>
}

function buildChunkStream(
  runId: string,
  chatSessionId: string,
  abortSignal: AbortSignal | undefined,
): ReadableStream<UIMessageChunk> {
  let ctrl: ReadableStreamDefaultController<UIMessageChunk> = null!
  let closed = false

  const readable = new ReadableStream<UIMessageChunk>({
    start(controller) {
      ctrl = controller
    },
  })

  const closeCleanly = () => {
    if (closed) {
      return
    }
    closed = true
    try {
      ctrl.close()
    }
    catch {
      // Already closed
    }
  }

  const closeWithError = (err: unknown) => {
    if (closed) {
      return
    }
    closed = true
    try {
      ctrl.error(err)
    }
    catch {
      // Already closed
    }
  }

  const safeEnqueue = (chunk: UIMessageChunk) => {
    if (closed) {
      return
    }
    try {
      ctrl.enqueue(chunk)
    }
    catch {
      // Stream closed by consumer
    }
  }

  void (async () => {
    try {
      const response = await fetch(`${SERVER_BASE}/chat/runs/${runId}/stream`, {
        signal: abortSignal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`SSE stream failed: ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) {
            continue
          }
          const data = line.slice(6).trim()
          if (!data) {
            continue
          }

          let event: StoredEventShape
          try {
            event = JSON.parse(data) as StoredEventShape
          }
          catch {
            continue
          }

          // Publish to local signal bus so passive observers (useChatTimelineEvent) stay in sync.
          publish('chat:timeline-event', {
            chatSessionId,
            messageId: event.runId,
            // eslint-disable-next-line ts/no-explicit-any
            event: event as any,
          })

          const chunks = projectTimelineEventToChunks(event)
          for (const chunk of chunks) {
            safeEnqueue(chunk)
          }

          if (event.type === 'run.completed' || event.type === 'run.aborted') {
            closeCleanly()
            return
          }
          if (event.type === 'run.failed') {
            const msg = event.error || 'chat run failed'
            closeWithError(new Error(msg))
            return
          }
        }
      }

      closeCleanly()
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        closeCleanly()
      }
      else {
        closeWithError(err)
      }
    }
  })()

  return readable
}

/** Returns the active runId for a session by inspecting the timeline, or null if no run is streaming. */
async function getActiveRunId(chatSessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`${SERVER_BASE}/chat/sessions/${chatSessionId}/timeline`)
    if (!res.ok) {
      return null
    }
    const groups = (await res.json()) as TimelineGroupShape[]
    const lastAssistant = [...groups].reverse().find(g => g.role === 'assistant')
    if (!lastAssistant || lastAssistant.status !== 'streaming') {
      return null
    }
    const lastEvent = lastAssistant.events.at(-1)
    return lastEvent?.runId ?? null
  }
  catch {
    return null
  }
}

/**
 * Create an SSE-backed ChatTransport for use in the web app.
 *
 * - sendMessages: POST /chat/sessions/:sessionId/runs -> get runId -> stream GET /chat/runs/:runId/stream
 * - reconnectToStream: detect active run via timeline, reconnect to its stream
 * - abort: PATCH /chat/runs/:runId { status: 'aborted' } -- call when user hits stop
 */
export function createSseChatTransport(chatSessionId: string): SseChatTransportHandle {
  const activeRunIdRef = { current: null as string | null }

  const transport: ChatTransport<UIMessage> = {
    sendMessages: async ({ messages, abortSignal }) => {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      if (!lastUser) {
        throw new Error('No user message to send')
      }
      const text = lastUser.parts
        .filter((p): p is { type: 'text', text: string } => p.type === 'text')
        .map(p => p.text)
        .join('')
        .trim()
      if (!text) {
        throw new Error('Cannot send an empty message')
      }

      const res = await fetch(`${SERVER_BASE}/chat/sessions/${chatSessionId}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: abortSignal,
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Failed to create chat run: ${res.status} ${body}`)
      }

      const { runId } = (await res.json()) as { runId: string }
      activeRunIdRef.current = runId

      return buildChunkStream(runId, chatSessionId, abortSignal)
    },

    reconnectToStream: async () => {
      const runId = await getActiveRunId(chatSessionId)
      if (!runId) {
        return null
      }
      activeRunIdRef.current = runId
      return buildChunkStream(runId, chatSessionId, undefined)
    },
  }

  const abort = async (): Promise<void> => {
    const runId = activeRunIdRef.current
    if (!runId) {
      return
    }
    activeRunIdRef.current = null
    await fetch(`${SERVER_BASE}/chat/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'aborted' }),
    }).catch(() => {})
  }

  return { transport, abort }
}
