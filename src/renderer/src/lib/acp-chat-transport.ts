// Input: window.electron.ipcRenderer (on/invoke), ipc proxy from @cradle/ipc/client
// Output: AcpChatTransport — ChatTransport implementation bridging IPC to AI SDK useChat
// Position: Renderer-side chat transport wiring ACP streaming via Electron IPC

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { ipc } from './ipc'

interface AcpChatTransportOptions {
  agentId: string
  sessionId: string
}

export class AcpChatTransport implements ChatTransport<UIMessage> {
  private agentId: string
  private sessionId: string

  constructor(options: AcpChatTransportOptions) {
    this.agentId = options.agentId
    this.sessionId = options.sessionId
  }

  async sendMessages({
    messages,
    abortSignal,
  }: {
    trigger: 'submit-message' | 'regenerate-message'
    chatId: string
    messageId: string | undefined
    messages: UIMessage[]
    abortSignal: AbortSignal | undefined
  }): Promise<ReadableStream<UIMessageChunk>> {
    const lastMessage = messages.at(-1)
    if (!lastMessage) {
      return new ReadableStream({
        start(c) {
          c.close()
        },
      })
    }

    const textPart = lastMessage.parts.find(p => p.type === 'text')
    const messageText = textPart && 'text' in textPart ? textPart.text : ''

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const cleanup = window.electron.ipcRenderer.on(
          'acp:session-chunk',
          (_event: unknown, data: { sessionId: string, chunk: UIMessageChunk }) => {
            if (data.sessionId !== this.sessionId) {
              return
            }
            controller.enqueue(data.chunk)
          },
        )

        const onDone = window.electron.ipcRenderer.on(
          'acp:session-done',
          (_event: unknown, data: { sessionId: string }) => {
            if (data.sessionId !== this.sessionId) {
              return
            }
            cleanup()
            onDone()
            controller.close()
          },
        )

        const onError = window.electron.ipcRenderer.on(
          'acp:session-error',
          (_event: unknown, data: { sessionId: string, error: string }) => {
            if (data.sessionId !== this.sessionId) {
              return
            }
            cleanup()
            onDone()
            onError()
            controller.error(new Error(data.error))
          },
        )

        abortSignal?.addEventListener('abort', () => {
          cleanup()
          onDone()
          onError()
          ipc?.acp.cancelPrompt(this.agentId, this.sessionId).catch(() => {})
          controller.close()
        })

        ipc?.acp.sendPrompt(this.agentId, this.sessionId, messageText).catch((err: unknown) => {
          cleanup()
          onDone()
          onError()
          controller.error(err instanceof Error ? err : new Error(String(err)))
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
