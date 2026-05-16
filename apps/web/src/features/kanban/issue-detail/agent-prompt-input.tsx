import { SendIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { getServerUrl } from '~/lib/electron'

import { kanbanKeys } from '../use-kanban'

interface AgentPromptInputProps {
  agentSessionId: string
  sessionStatus: string
  issueId: string
}

async function sendPrompt(agentSessionId: string, text: string) {
  const baseUrl = getServerUrl()
  const res = await fetch(`${baseUrl}/issue-agent-sessions/${agentSessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`Failed to send prompt: ${res.status}`)
  return res.json()
}

export function AgentPromptInput({ agentSessionId, sessionStatus, issueId }: AgentPromptInputProps) {
  const [text, setText] = useState('')
  const qc = useQueryClient()
  const isAgentBusy = sessionStatus === 'active' || sessionStatus === 'created'

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isAgentBusy) return
    setText('')
    await sendPrompt(agentSessionId, trimmed)
    qc.invalidateQueries({ queryKey: kanbanKeys.agentActivities(agentSessionId) })
  }, [text, isAgentBusy, agentSessionId, qc])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || !e.shiftKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="flex items-end gap-2 border-t border-border px-3 py-2">
      <textarea
        className="min-h-8 flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        placeholder={isAgentBusy ? 'Agent is working...' : 'Send a message...'}
        disabled={isAgentBusy}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30"
        disabled={isAgentBusy || !text.trim()}
        onClick={handleSubmit}
      >
        <SendIcon className="size-3.5" />
      </button>
    </div>
  )
}
