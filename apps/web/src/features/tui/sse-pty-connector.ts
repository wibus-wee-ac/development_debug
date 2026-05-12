// Input: sessionId, server HTTP API
// Output: openPtyStream — connects to SSE stream and publishes pty events to local signal bus
// Position: apps/web/src/features/tui/sse-pty-connector.ts — web replacement for IPC pty.data subscription

import { publish } from '~/lib/signal'

const SERVER_BASE: string = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'

type TerminalStreamEvent
  = | { type: 'terminal.buffer', data: string }
    | { type: 'terminal.data', data: string }
    | { type: 'terminal.exit', exitCode: number | null, signal: string | null }

/**
 * Open a SSE connection to /terminal-sessions/:sessionId/stream and publish
 * incoming events to the local signal bus (pty:data, pty:exit).
 *
 * Returns a cleanup function to close the connection.
 */
export function openPtyStream(sessionId: string, abortSignal?: AbortSignal): () => void {
  const controller = new AbortController()
  const signal = abortSignal
    ? AbortSignal.any([controller.signal, abortSignal])
    : controller.signal

  void (async () => {
    try {
      const response = await fetch(`${SERVER_BASE}/terminal-sessions/${sessionId}/stream`, { signal })
      if (!response.ok || !response.body) {
        return
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

          let event: TerminalStreamEvent
          try {
            event = JSON.parse(data) as TerminalStreamEvent
          }
          catch {
            continue
          }

          if (event.type === 'terminal.buffer' || event.type === 'terminal.data') {
            publish('pty:data', { sessionId, data: event.data })
          }
          else if (event.type === 'terminal.exit') {
            publish('pty:exit', {
              sessionId,
              exitCode: event.exitCode ?? 0,
              signal: typeof event.signal === 'string' ? Number.parseInt(event.signal, 10) || null : null,
            })
            break
          }
        }
      }
    }
    catch {
      // AbortError or network failure — connection closed normally
    }
  })()

  return () => {
    controller.abort()
  }
}
