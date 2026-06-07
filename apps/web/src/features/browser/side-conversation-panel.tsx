import type { FileUIPart, UIMessage } from 'ai'
import { BotIcon, SendIcon, XCircleIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'
import { ChatThinkingEffort, ChatRuntimeSettingsPatch, startSideConversationResponse } from '../chat/commands/chat-response-command'
import { ChatContextPart, toOrderedUserMessageParts } from '../chat/context/chat-context-parts'
import { MessageBubble } from '../chat/rendering/message-bubble'
import { ChatStreamingHandler } from '../chat/transport/chat-streaming-handler'
import { buildUIMessageChunkStreamFromResponse } from '../chat/transport/sse-chat-transport'

interface SideConversationPanelProps {
  sideConversationId: string
  parentSessionId: string
  title: string
}

export interface SubmitSideConversationMessageInput {
  sideConversationId: string
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  modelId?: string
  thinkingEffort?: ChatThinkingEffort | null | undefined
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export function buildSideConversationViewId(sideConversationId: string): string {
  return `side:${sideConversationId}`
}

export async function submitSideConversationMessage(input: SubmitSideConversationMessageInput): Promise<void> {
  const text = input.text.trim()
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    return
  }

  const viewSessionId = buildSideConversationViewId(input.sideConversationId)
  const userMessageId = `side-user-${Date.now()}`
  const userParts = toOrderedUserMessageParts(text, contextParts, input.text) as UIMessage['parts']
  userParts.push(...files)
  useChatStore.getState().appendMessage(viewSessionId, {
    id: userMessageId,
    role: 'user',
    parts: userParts,
  })

  const assistantMessageId = `side-assistant-${Date.now()}`
  const controller = new AbortController()
  const handler = new ChatStreamingHandler(
    viewSessionId,
    assistantMessageId,
    performance.now(),
    { mode: 'local', useStoredMessageSnapshot: false },
  )
  handler.start(controller)

  try {
    const response = await startSideConversationResponse({
      sideConversationId: input.sideConversationId,
      body: {
        text,
        files,
        contextParts,
        modelId: input.modelId,
        thinkingEffort: input.thinkingEffort === null ? undefined : input.thinkingEffort,
        runtimeSettings: input.runtimeSettings,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to start side response: ${response.status} ${body}`)
    }
    await handler.consume(buildUIMessageChunkStreamFromResponse(response, viewSessionId))
    handler.finish()
  }
  catch (error) {
    if (!controller.signal.aborted) {
      handler.fail(error instanceof Error ? error.message : 'Side response failed')
    }
  }
}

export function SideConversationPanel({
  sideConversationId,
  parentSessionId,
  title,
}: SideConversationPanelProps) {
  const viewSessionId = useMemo(() => buildSideConversationViewId(sideConversationId), [sideConversationId])
  const messages = useChatStore(chatSelectors.messages(viewSessionId))
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const text = draft.trim()
    if (!text || submitting) {
      return
    }
    setDraft('')
    setSubmitting(true)
    setError(null)
    try {
      await submitSideConversationMessage({ sideConversationId, text })
    }
    catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Side response failed')
    }
    finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="side-conversation-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-card px-3 py-2">
        <div className="flex size-6 shrink-0 items-center rounded-md bg-primary/10">
          <BotIcon className="mx-auto size-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{title}</p>
          <p className="truncate text-[10px] text-muted-foreground">{parentSessionId}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length > 0
? (
          <div className="space-y-3">
            {messages.map(message => (
              <SideConversationMessage key={message.id} viewSessionId={viewSessionId} messageId={message.id} />
            ))}
          </div>
        )
: (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
            <BotIcon className="size-8 opacity-40" />
            <p className="text-[11px]">Side conversation</p>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
          <XCircleIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      )}

      <form
        className="flex shrink-0 gap-2 border-t border-border/50 bg-card p-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
          className={cn(
            'min-h-9 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none',
            'placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15',
          )}
          placeholder="Message"
          rows={2}
        />
        <Button type="submit" size="icon" disabled={!draft.trim() || submitting} aria-label="Send side message">
          <SendIcon className="size-4" />
        </Button>
      </form>
    </div>
  )
}

function SideConversationMessage({
  viewSessionId,
  messageId,
}: {
  viewSessionId: string
  messageId: string
}) {
  const message = useChatStore(chatSelectors.message(viewSessionId, messageId))
  const isStreaming = useChatStore(chatSelectors.isVisibleStreamingMessage(viewSessionId, messageId))
  if (!message) {
    return null
  }
  return (
    <MessageBubble
      message={message}
      isStreaming={isStreaming}
      executionDetailsDefaultOpen={false}
    />
  )
}
