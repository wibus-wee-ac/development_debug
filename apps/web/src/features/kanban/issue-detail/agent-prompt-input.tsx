import { SendIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import type { ChatContinuationMode } from '~/features/chat/chat-response-command'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { getServerUrl } from '~/lib/electron'

interface AgentPromptInputProps {
  agentSessionId: string
  chatSessionId: string | null
  sessionStatus: string
  onQueued: () => void
}

function invertContinuationMode(mode: ChatContinuationMode): ChatContinuationMode {
  return mode === 'queue' ? 'steer' : 'queue'
}

async function enqueueAgentContinuation(input: {
  agentSessionId: string
  mode: ChatContinuationMode
  text: string
}) {
  const baseUrl = getServerUrl()
  const res = await fetch(`${baseUrl}/issue-agent-sessions/${input.agentSessionId}/continuation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: input.mode, text: input.text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to enqueue continuation: ${res.status} ${body}`)
  }
  return res.json()
}

export function AgentPromptInput({ agentSessionId, chatSessionId, sessionStatus, onQueued }: AgentPromptInputProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const { data: chatPreferences } = useChatPreferencesQuery()
  const isAgentBusy = sessionStatus === 'active' || sessionStatus === 'created'

  const handleSubmit = useCallback(async (options?: { invertContinuationMode?: boolean }) => {
    const trimmed = text.trim()
    if (!trimmed || !chatSessionId || isSending) {
      return
    }
    const defaultMode = chatPreferences?.continuationBehavior ?? 'queue'
    const mode = options?.invertContinuationMode ? invertContinuationMode(defaultMode) : defaultMode
    setError(null)
    setIsSending(true)
    setText('')
    try {
      await enqueueAgentContinuation({ agentSessionId, mode, text: trimmed })
      onQueued()
    }
    catch (err) {
      setText(trimmed)
      setError(err instanceof Error ? err.message : 'Failed to enqueue continuation')
    }
    finally {
      setIsSending(false)
    }
  }, [agentSessionId, chatPreferences?.continuationBehavior, chatSessionId, isSending, onQueued, text])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
      e.preventDefault()
      void handleSubmit({ invertContinuationMode: e.shiftKey && e.metaKey })
    }
  }, [handleSubmit])

  const defaultMode = chatPreferences?.continuationBehavior ?? 'queue'
  const placeholder = !chatSessionId
    ? 'Chat session is starting...'
    : isAgentBusy
      ? defaultMode === 'steer' ? 'Send steer...' : 'Queue follow-up...'
      : 'Queue follow-up...'

  return (
    <div className="border-t border-border px-3 py-2">
      {error && (
        <div className="mb-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-8 flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          placeholder={placeholder}
          aria-label={defaultMode === 'steer' ? 'Send steer' : 'Queue follow-up'}
          disabled={!chatSessionId || isSending}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
          disabled={!chatSessionId || isSending || !text.trim()}
          onClick={() => void handleSubmit()}
          aria-label={defaultMode === 'steer' ? 'Send steer' : 'Queue prompt'}
        >
          <SendIcon className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
