import { CheckIcon, MessageSquareIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import { formatTimestamp } from '../shared/diff-items'
import type { ReviewThread } from '../shared/types'

interface InlineThreadProps {
  thread: ReviewThread
  onReply: (threadId: string, bodyMarkdown: string) => void
  replyPending: boolean
  onResolve: (threadId: string) => void
  resolvePending: boolean
  onExpandedChange?: (id: string | null) => void
}

export function InlineThread({
  thread,
  onReply,
  replyPending,
  onResolve,
  resolvePending,
  onExpandedChange,
}: InlineThreadProps) {
  const [expanded, setExpanded] = useState(thread.state !== 'resolved')
  const [draft, setDraft] = useState('')
  const lastComment = thread.comments.at(-1)

  const toggle = () => {
    const next = !expanded
    setExpanded(next)
    onExpandedChange?.(next ? thread.id : null)
  }

  return (
    <div
      className="my-1 overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      data-testid="inline-thread"
      data-thread-state={thread.state}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full',
            thread.state === 'resolved' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
          )}
        >
          {thread.state === 'resolved' ? <CheckIcon className="size-2.5" /> : <MessageSquareIcon className="size-2.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {lastComment ? lastComment.bodyMarkdown.split('\n')[0] : 'Thread'}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {thread.comments.length}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-border/60 px-2.5 py-2">
          {thread.comments.map(comment => (
            <div key={comment.id} className="space-y-1">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{comment.authorId}</span>
                <span className="tabular-nums">{formatTimestamp(comment.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/90">
                {comment.bodyMarkdown}
              </p>
            </div>
          ))}

          {thread.state !== 'resolved' && (
            <>
              <Textarea
                value={draft}
                onChange={event => setDraft(event.target.value)}
                placeholder="Reply…"
                className="min-h-12 resize-none text-[11px]"
              />
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() => onResolve(thread.id)}
                  disabled={resolvePending}
                >
                  Resolve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() => {
                    const body = draft.trim()
                    if (body) {
                      onReply(thread.id, body)
                      setDraft('')
                    }
                  }}
                  disabled={!draft.trim() || replyPending}
                >
                  Reply
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
