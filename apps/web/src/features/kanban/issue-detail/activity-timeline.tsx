import { StaticRender } from '@cradle/streamdown'
import type { TFunction } from 'i18next'
import {
  AddCircleLine as CirclePlusIcon,
  GitBranchLine as GitBranchIcon,
  SparklesLine as SparklesIcon,
  DeleteLine as Trash2Icon,
  UserFollowLine as UserRoundCheckIcon,
  UserRemoveLine as UserRoundMinusIcon
} from '@mingcute/react'
import type { ElementType, ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import type {
  IssueActivityAction,
  IssueActivityField,
  IssueActivityValue,
  IssueActivityValueToken,
  IssueCommentAuthor,
  KanbanIssueActivityItem,
} from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import { AssigneeAvatar } from '../shared/assignee-avatar'
import { useAddComment, useDeleteComment, useIssueActivity } from '../use-kanban'

interface ActivityTimelineProps {
  issueId: string
  readOnly?: boolean
}

type KanbanTranslation = TFunction<'kanban'>
type KanbanKey = keyof typeof import('~/locales/default').default.kanban

export const ActivityTimeline = ({ issueId, readOnly = false }: ActivityTimelineProps) => {
  const { t } = useTranslation('kanban')
  const { data: activity = [] } = useIssueActivity(issueId, !readOnly)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const [commentText, setCommentText] = useState('')
  const timelineItems = activity.toSorted((left, right) => left.createdAt - right.createdAt)

  const handleSubmit = () => {
    if (readOnly) {
      return
    }
    const trimmed = commentText.trim()
    if (!trimmed) {
      return
    }
    addComment.mutate({ issueId, content: trimmed })
    setCommentText('')
  }

  const handleDeleteComment = (commentId: string) => {
    if (readOnly) {
      return
    }
    deleteComment.mutate({ id: commentId, issueId })
  }

  return (
    <div data-testid="issue-activity-timeline">
      <h3 className="text-sm font-semibold text-foreground text-balance">
        {t('issue.activity.title')}
      </h3>

      <div className="mt-3 flex flex-col gap-3">
        {timelineItems.map(item => (
          <ActivityItem
            key={item.id}
            item={item}
            onDeleteComment={
              !readOnly && item.kind === 'comment' && item.actor.kind === 'user'
                ? handleDeleteComment
                : undefined
            }
          />
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-card shadow-xs">
        <textarea
          value={commentText}
          aria-label={t('issue.comment.placeholder')}
          onChange={e => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          placeholder={t('issue.comment.placeholder')}
          rows={2}
          readOnly={readOnly}
          data-testid="issue-comment-input"
          className={cn(
            'w-full resize-none rounded-t-lg bg-transparent px-3 py-2.5 text-[13px] text-foreground outline-none placeholder:text-text-dim',
            readOnly && 'cursor-default',
          )}
        />
        <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5">
          <span className="text-[11px] text-text-dim">
            {t('issue.comment.submitHint', { shortcut: '⌘↵' })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[12px]"
            onClick={handleSubmit}
            disabled={readOnly || !commentText.trim()}
            data-testid="issue-comment-submit"
          >
            {t('issue.comment.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

const systemEventConfig = {
  delegated: { icon: UserRoundCheckIcon },
  system: { icon: GitBranchIcon },
  undelegated: { icon: UserRoundMinusIcon },
} satisfies Record<string, { icon: ElementType }>

const actionLabelKeys = {
  'added-description': 'issue.activity.action.addedDescription',
  'changed-field': 'issue.activity.action.changedField',
  'cleared-description': 'issue.activity.action.clearedDescription',
  'renamed-issue': 'issue.activity.action.renamedIssue',
  'updated-description': 'issue.activity.action.updatedDescription',
} as const satisfies Record<IssueActivityAction, KanbanKey>

const fieldLabelKeys = {
  'assignee': 'property.assignee',
  'description': 'issue.activity.field.description',
  'due-date': 'display.dueDate',
  'labels': 'property.labels',
  'metadata': 'issue.activity.field.metadata',
  'milestone': 'property.milestone',
  'parent': 'issue.activity.field.parent',
  'priority': 'property.priority',
  'status': 'property.status',
  'title': 'table.title',
} as const satisfies Record<IssueActivityField, KanbanKey>

const valueTokenLabelKeys = {
  'changed': 'issue.activity.value.changed',
  'current-user': 'assignee.currentUser',
  'empty': 'issue.activity.value.empty',
  'no-due-date': 'issue.activity.value.noDueDate',
  'no-labels': 'issue.activity.value.noLabels',
  'no-milestone': 'issue.label.noMilestone',
  'no-parent': 'issue.activity.value.noParent',
  'no-status': 'issue.activity.value.noStatus',
  'priority-high': 'priority.high',
  'priority-low': 'priority.low',
  'priority-medium': 'priority.medium',
  'priority-none': 'priority.none',
  'priority-urgent': 'priority.urgent',
  'unassigned': 'assignee.unassigned',
  'unknown-issue': 'issue.activity.value.unknownIssue',
  'unknown-milestone': 'issue.activity.value.unknownMilestone',
  'unknown-status': 'issue.activity.value.unknownStatus',
  'unknown-user': 'assignee.unknownUser',
} as const satisfies Record<IssueActivityValueToken, KanbanKey>

const ActivityItem = ({
  item,
  onDeleteComment,
}: {
  item: KanbanIssueActivityItem
  onDeleteComment?: (commentId: string) => void
}) => {
  if (item.kind === 'created') {
    return <CreatedItem item={item} />
  }
  if (item.kind === 'field-change') {
    return <FieldChangeItem item={item} />
  }
  return <CommentItem item={item} onDeleteComment={onDeleteComment} />
}

const CreatedItem = ({ item }: { item: KanbanIssueActivityItem }) => {
  const { t } = useTranslation('kanban')
  return (
    <TimelineLine
      icon={<CirclePlusIcon className="size-3.5 !text-text-tertiary" aria-hidden="true" />}
      testId={`activity-created-${item.id}`}
    >
      <span className="font-medium text-foreground">{formatActorName(item.actor, t)}</span>
      <span className="text-text-dim">{t('issue.activity.action.createdIssue')}</span>
      <ActivityTime>{formatRelativeTime(item.createdAt, t)}</ActivityTime>
    </TimelineLine>
  )
}

const FieldChangeItem = ({ item }: { item: KanbanIssueActivityItem }) => {
  const { t } = useTranslation('kanban')
  const fieldChange = item.fieldChange
  if (!fieldChange) {
    return null
  }

  return (
    <TimelineLine
      icon={<GitBranchIcon className="size-3.5 !text-text-tertiary" aria-hidden="true" />}
      testId={`field-change-${item.id}`}
    >
      <span className="font-medium text-foreground">{formatActorName(item.actor, t)}</span>
      <span className="text-text-dim">
        {formatAction(fieldChange.action, fieldChange.field, t)}
      </span>
      {fieldChange.fromValue && fieldChange.toValue && (
        <>
          <ActivityValue>{formatActivityValue(fieldChange.fromValue, t)}</ActivityValue>
          <span className="text-text-dim">{t('issue.activity.action.to')}</span>
          <ActivityValue>{formatActivityValue(fieldChange.toValue, t)}</ActivityValue>
        </>
      )}
      <ActivityTime>{formatRelativeTime(item.createdAt, t)}</ActivityTime>
    </TimelineLine>
  )
}

const CommentItem = ({
  item,
  onDeleteComment,
}: {
  item: KanbanIssueActivityItem
  onDeleteComment?: (commentId: string) => void
}) => {
  const { t } = useTranslation('kanban')
  const comment = item.comment
  const handleDelete = () => {
    onDeleteComment?.(item.id)
  }

  if (!comment) {
    return null
  }

  if (comment.systemKind) {
    const cfg = systemEventConfig[comment.systemKind] ?? systemEventConfig.system
    const Icon = cfg.icon
    return (
      <TimelineLine
        icon={<Icon className="size-3.5 text-text-tertiary" aria-hidden="true" />}
        testId={`comment-${item.id}`}
      >
        <span className="font-medium text-foreground">{formatActorName(item.actor, t)}</span>
        <span className="text-text-dim">{comment.content}</span>
        <ActivityTime>{formatRelativeTime(item.createdAt, t)}</ActivityTime>
      </TimelineLine>
    )
  }

  const isAiAuthored = item.actor.kind === 'agent' || item.actor.kind === 'provider-target'

  return (
    <div className="group flex gap-2.5" data-testid={`comment-${item.id}`}>
      {isAiAuthored
? (
        item.actor.avatarUrl
? (
          <img
            src={item.actor.avatarUrl}
            alt={item.actor.displayName}
            className="size-5.5 shrink-0 rounded-full mt-0.5 object-cover"
          />
        )
: (
          <div className="flex size-5.5 shrink-0 items-center justify-center mt-0.5">
            <SparklesIcon className="size-3.5 !text-text-tertiary" aria-hidden="true" />
          </div>
        )
      )
: (
        <AssigneeAvatar
          name={formatActorName(item.actor, t)}
          size={22}
          className="mt-0.5 shrink-0"
        />
      )}
      <div className={cn('flex-1 min-w-0 rounded-lg border border-border px-3 py-2.5 bg-card')}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {formatActorName(item.actor, t)}
          </span>
          {formatActorLabel(item.actor, t) && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-fill text-text-tertiary font-medium leading-none">
              {formatActorLabel(item.actor, t)}
            </span>
          )}
          <ActivityTime>{formatRelativeTime(item.createdAt, t)}</ActivityTime>
          {onDeleteComment && (
            <button
              type="button"
              onClick={handleDelete}
              className="ml-auto -mr-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-fill text-text-tertiary hover:text-foreground"
              aria-label={t('issue.comment.deleteAria')}
            >
              <Trash2Icon className="size-3" />
            </button>
          )}
        </div>
        <StaticRender
          content={comment.content}
          className={cn(
            'mt-1 min-w-0 text-[13px] leading-relaxed text-foreground/90 !tracking-normal',
            '[&_a]:break-words [&_blockquote]:my-2 [&_blockquote]:rounded-md [&_blockquote]:px-3 [&_blockquote]:py-2',
            '[&_h1]:!tracking-normal [&_h2]:!tracking-normal [&_thead_th]:!tracking-normal',
            '[&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[15px]',
            '[&_h2]:border-0 [&_h2]:pb-0 [&_h2]:text-[14px]',
            '[&_h3]:text-[13px] [&_h4]:text-[13px] [&_h5]:text-[13px] [&_h6]:text-[13px]',
            '[&_pre]:max-w-full [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto',
          )}
        />
      </div>
    </div>
  )
}

function TimelineLine({
  children,
  icon,
  testId,
}: {
  children: ReactNode
  icon: ReactNode
  testId: string
}) {
  return (
    <div className="group flex gap-2.5" data-testid={testId}>
      <div className="flex size-5.5 shrink-0 items-center justify-center mt-0.5">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-5">
        {children}
      </div>
    </div>
  )
}

function ActivityValue({ children }: { children: string }) {
  return (
    <span className="max-w-full truncate rounded-md bg-fill px-1.5 py-0.5 text-[11px] text-text-tertiary">
      {children}
    </span>
  )
}

function ActivityTime({ children }: { children: string }) {
  if (!children) {
    return null
  }

  return (
    <span className="whitespace-nowrap text-[11px] text-text-dim tabular-nums">{children}</span>
  )
}

function formatActorName(actor: IssueCommentAuthor, t: KanbanTranslation): string {
  if (actor.kind === 'user' && (actor.id === '__self__' || !actor.id)) {
    return t('issue.activity.actor.you')
  }
  if (actor.kind === 'system') {
    return t('issue.activity.actor.system')
  }
  return actor.displayName
}

function formatActorLabel(actor: IssueCommentAuthor, t: KanbanTranslation): string | null {
  if (actor.kind === 'provider-target') {
    return t('issue.activity.actor.provider')
  }
  if (actor.kind === 'agent' && actor.label === 'Agent') {
    return t('issue.activity.actor.agent')
  }
  return actor.label
}

function formatAction(
  action: IssueActivityAction,
  field: IssueActivityField | null,
  t: KanbanTranslation,
): string {
  if (action === 'changed-field') {
    const fieldLabel = field ? t(fieldLabelKeys[field]) : t('issue.activity.field.metadata')
    return t(actionLabelKeys[action], { field: fieldLabel })
  }
  return t(actionLabelKeys[action])
}

function formatActivityValue(value: IssueActivityValue, t: KanbanTranslation): string {
  if (value.kind === 'text') {
    return value.text
  }
  if (value.kind === 'token') {
    return t(valueTokenLabelKeys[value.token])
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(value.timestamp * 1000))
}

function formatRelativeTime(ts: number | null | undefined, t: KanbanTranslation): string {
  if (!ts) {
    return ''
  }
  const diff = Date.now() - ts * 1000
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) {
    return t('issue.activity.time.justNow')
  }
  if (minutes < 60) {
    return t('issue.activity.time.minutesAgo', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('issue.activity.time.hoursAgo', { count: hours })
  }
  const days = Math.floor(hours / 24)
  return t('issue.activity.time.daysAgo', { count: days })
}
