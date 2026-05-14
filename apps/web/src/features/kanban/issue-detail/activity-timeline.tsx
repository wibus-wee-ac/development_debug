import { useCallback, useState } from 'react'

import { Button } from '~/components/ui/button'
import type { KanbanIssueComment } from '~/lib/types'

import { AssigneeAvatar } from '../shared/assignee-avatar'
import { useAddComment, useComments } from '../use-kanban'

interface ActivityTimelineProps {
  issueId: string
}

export function ActivityTimeline({ issueId }: ActivityTimelineProps) {
  const { data: comments = [] } = useComments(issueId)
  const addComment = useAddComment()
  const [commentText, setCommentText] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = commentText.trim()
    if (!trimmed) return
    addComment.mutate({ issueId, content: trimmed })
    setCommentText('')
  }, [commentText, issueId, addComment])

  return (
    <div data-testid="issue-activity-timeline">
      <span className="text-[12px] font-medium text-muted-foreground">Activity</span>

      <div className="mt-3 flex flex-col gap-3">
        {comments.map(comment => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </div>

      {/* Comment input */}
      <div className="mt-4">
        <textarea
          value={commentText}
          onChange={e => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder="Leave a comment..."
          rows={2}
          data-testid="issue-comment-input"
          className="w-full resize-none rounded-md border border-border/50 bg-transparent px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-border transition-colors"
        />
        <div className="mt-1.5 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[12px]"
            onClick={handleSubmit}
            disabled={!commentText.trim()}
            data-testid="issue-comment-submit"
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  )
}

function CommentItem({ comment }: { comment: KanbanIssueComment }) {
  const isSystem = comment.authorKind?.startsWith('system')

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1" data-testid={`comment-${comment.id}`}>
        <span className="text-[12px] text-muted-foreground/60">
          {comment.content}
        </span>
        <span className="text-[11px] text-muted-foreground/40">
          {formatRelativeTime(comment.createdAt)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5" data-testid={`comment-${comment.id}`}>
      <AssigneeAvatar name={comment.authorId} size={22} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {comment.authorKind === 'agent' ? 'Agent' : 'You'}
          </span>
          <span className="text-[11px] text-muted-foreground/50">
            {formatRelativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
