import { GitBranchIcon, SparklesIcon, Trash2Icon, UserRoundCheckIcon, UserRoundMinusIcon } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import type { KanbanIssueCommentView } from '~/lib/types'

import { AssigneeAvatar } from '../shared/assignee-avatar'
import { useAddComment, useComments, useDeleteComment } from '../use-kanban'

interface ActivityTimelineProps {
  issueId: string
}

export function ActivityTimeline({ issueId }: ActivityTimelineProps) {
  const { data: comments = [] } = useComments(issueId)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const [commentText, setCommentText] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = commentText.trim()
    if (!trimmed) {
      return
    }
    addComment.mutate({ issueId, content: trimmed })
    setCommentText('')
  }, [commentText, issueId, addComment])

  return (
    <div data-testid="issue-activity-timeline">
      <h3 className="text-sm font-semibold text-foreground text-balance">Activity</h3>

      <div className="mt-3 flex flex-col gap-3">
        {comments.map(comment => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onDelete={comment.author.kind === 'user' ? () => deleteComment.mutate({ id: comment.id, issueId }) : undefined}
          />
        ))}
      </div>

      {/* Comment input */}
      <div className="mt-4 rounded-lg border border-border bg-card shadow-xs">
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
          className="w-full resize-none rounded-t-lg bg-transparent px-3 py-2.5 text-[13px] text-foreground outline-none placeholder:text-text-dim"
        />
        <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5">
          <span className="text-[11px] text-text-dim">⌘↵ to submit</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[12px]"
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

const systemEventConfig: Record<string, { icon: React.ElementType }> = {
  'system.delegated': { icon: UserRoundCheckIcon },
  'system.undelegated': { icon: UserRoundMinusIcon },
  'system': { icon: GitBranchIcon },
}

function CommentItem({ comment, onDelete }: { comment: KanbanIssueCommentView, onDelete?: () => void }) {
  const kind = comment.author.kind
  const isSystem = kind.startsWith('system')

  if (isSystem) {
    const cfg = systemEventConfig[kind] ?? systemEventConfig.system
    const Icon = cfg.icon
    return (
      <div className="flex items-center gap-2.5 py-0.5" data-testid={`comment-${comment.id}`}>
        <div className="flex size-5.5 shrink-0 items-center justify-center">
          <Icon className="size-3.5 text-text-tertiary" aria-hidden="true" />
        </div>
        <span className="text-[12px] text-text-tertiary">{comment.content}</span>
        <span className="text-[11px] text-text-dim shrink-0">{formatRelativeTime(comment.createdAt)}</span>
      </div>
    )
  }

  const isAgent = kind === 'agent'
  const author = comment.author

  return (
    <div className="group flex gap-2.5" data-testid={`comment-${comment.id}`}>
      {isAgent
        ? author.avatarUrl
          ? (
            <img
              src={author.avatarUrl}
              alt={author.displayName}
              className="size-5.5 shrink-0 rounded-full mt-0.5 object-cover"
            />
          )
          : (
            <div className="flex size-5.5 shrink-0 items-center justify-center mt-0.5">
              <SparklesIcon className="size-3.5 text-text-tertiary" aria-hidden="true" />
            </div>
          )
        : (
          <AssigneeAvatar name={author.displayName} size={22} className="mt-0.5 shrink-0" />
        )}
      <div
        className={cn(
          'flex-1 min-w-0 rounded-lg border border-border px-3 py-2.5',
          isAgent ? 'bg-fill/50' : 'bg-card',
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {author.displayName}
          </span>
          {author.label && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-fill text-text-tertiary font-medium leading-none">
              {author.label}
            </span>
          )}
          <span className="text-[11px] text-text-dim">
            {formatRelativeTime(comment.createdAt)}
          </span>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="ml-auto -mr-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill text-text-tertiary hover:text-foreground"
              aria-label="Delete comment"
            >
              <Trash2Icon className="size-3" />
            </button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
      </div>
    </div>
  )
}

function formatRelativeTime(ts: number | null | undefined): string {
  if (!ts) {
    return ''
  }
  const diff = Date.now() - ts * 1000
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) {
    return 'just now'
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
