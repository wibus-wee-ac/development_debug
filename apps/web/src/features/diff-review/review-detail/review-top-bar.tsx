import {
  CheckLine as CheckIcon,
  GitCommitLine as GitCommitHorizontalIcon,
  GitCommitLine as GitCommitVerticalIcon,
  TreeLine as ListTreeIcon,
  Message1Line as MessageSquareIcon,
  Refresh1Line as RefreshCwIcon,
  Rows3Line as Rows3Icon,
  SendLine as SendIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon
} from '@mingcute/react'
import { useTransition } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

import { formatChangeStats, sourceLabel } from '../shared/diff-items'
import type { CradleDiffReview, DiffStyle, ReviewDecision } from '../shared/types'

interface ReviewTopBarProps {
  review: CradleDiffReview
  diffStyle: DiffStyle
  onDiffStyleChange: (style: DiffStyle) => void
  onPreference: (input: { hideWhitespaceOnly?: boolean, collapseGeneratedFiles?: boolean }) => void
  preferencePending: boolean
  onSubmit: (decision: ReviewDecision, bodyMarkdown: string) => void
  submitPending: boolean
  onRefresh: () => void
  refreshPending: boolean
  isFetching: boolean
  onOpenGuide: () => void
  hasGuide: boolean
  onOpenCommit?: () => void
  hasCommitPlan?: boolean
  threadsRailCollapsed: boolean
  onToggleThreadsRail: () => void
  openThreadCount: number
}

const REVIEW_STATE_TONE: Record<CradleDiffReview['reviewState'], string> = {
  'unreviewed': 'bg-muted-foreground/40',
  'in-review': 'bg-sky-500',
  'changes-requested': 'bg-orange-500',
  'approved': 'bg-emerald-500',
  'commented': 'bg-muted-foreground/40',
}

export function ReviewTopBar({
  review,
  diffStyle,
  onDiffStyleChange,
  onPreference,
  preferencePending,
  onSubmit,
  submitPending,
  onRefresh,
  refreshPending,
  isFetching,
  onOpenGuide,
  hasGuide,
  onOpenCommit,
  hasCommitPlan,
  threadsRailCollapsed,
  onToggleThreadsRail,
  openThreadCount,
}: ReviewTopBarProps) {
  const [isDiffStylePending, startDiffStyleTransition] = useTransition()
  const refreshing = refreshPending || isFetching

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 px-3" data-testid="review-top-bar">
      <span className={cn('size-1.5 shrink-0 rounded-full', REVIEW_STATE_TONE[review.reviewState])} aria-hidden />
      <div className="min-w-0">
        <h1 className="truncate text-[13px] font-medium leading-tight text-foreground">{review.title}</h1>
        <p className="truncate text-[12px] tabular-nums text-muted-foreground/70">
          {sourceLabel(review.sourceKind)}
          {' · '}
          {formatChangeStats(review)}
        </p>
      </div>

      <div className="flex-1" />

      {/* Layout — primary view control, stays visible. */}
      <div className="flex items-center rounded-md border border-border/60 p-px">
        <LayoutPill
          active={diffStyle === 'unified'}
          onClick={() => startDiffStyleTransition(() => onDiffStyleChange('unified'))}
          disabled={isDiffStylePending}
        >
          <Rows3Icon className="size-3.5" />
          Unified
        </LayoutPill>
        <LayoutPill
          active={diffStyle === 'split'}
          onClick={() => startDiffStyleTransition(() => onDiffStyleChange('split'))}
          disabled={isDiffStylePending}
        >
          <GitCommitVerticalIcon className="size-3.5" />
          Split
        </LayoutPill>
      </div>

      {/* Display filters — secondary, icon popover. */}
      <DisplayPopover
        hideWhitespaceOnly={review.preferences.hideWhitespaceOnly}
        collapseGeneratedFiles={review.preferences.collapseGeneratedFiles}
        pending={preferencePending}
        onToggleWhitespace={() => onPreference({ hideWhitespaceOnly: !review.preferences.hideWhitespaceOnly })}
        onToggleGenerated={() => onPreference({ collapseGeneratedFiles: !review.preferences.collapseGeneratedFiles })}
      />

     <Button variant="ghost" size="sm" onClick={onOpenGuide} className="h-7 gap-1.5 px-2 text-[12px]">
       <ListTreeIcon className="size-3.5" />
       Guide
       {hasGuide && <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Guide generated" />}
     </Button>

      {/* Commit plan — only for reviews whose changes can be staged into commits. */}
      {onOpenCommit && (
        <Button variant="ghost" size="sm" onClick={onOpenCommit} className="h-7 gap-1.5 px-2 text-[12px]">
          <GitCommitHorizontalIcon className="size-3.5" />
          Commit
          {hasCommitPlan && <span className="size-1.5 rounded-full bg-sky-500" aria-label="Commit plan exists" />}
        </Button>
      )}

      {/* Threads toggle — visible, badge carries the count. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('relative size-7', threadsRailCollapsed && 'bg-muted text-foreground')}
        onClick={onToggleThreadsRail}
        aria-label={threadsRailCollapsed ? 'Show threads' : 'Hide threads'}
        title={threadsRailCollapsed ? 'Show threads' : 'Hide threads'}
      >
        <MessageSquareIcon className="size-3.5" />
        {openThreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-medium text-white">
            {openThreadCount}
          </span>
        )}
      </Button>

      {/* Review — primary action. */}
      <ReviewPopover
        pending={submitPending}
        state={review.reviewState}
        onComment={() => onSubmit('comment', '')}
        onRequestChanges={() => onSubmit('request-changes', '')}
        onApprove={() => onSubmit('approve', '')}
      />

      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
      >
        <RefreshCwIcon className={cn('size-3.5', refreshing && 'animate-spin')} />
      </Button>
    </header>
  )
}

function LayoutPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[12px] font-medium transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function DisplayPopover({
  hideWhitespaceOnly,
  collapseGeneratedFiles,
  pending,
  onToggleWhitespace,
  onToggleGenerated,
}: {
  hideWhitespaceOnly: boolean
  collapseGeneratedFiles: boolean
  pending: boolean
  onToggleWhitespace: () => void
  onToggleGenerated: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button variant="ghost" size="icon" className="size-7" disabled={pending} aria-label="Display options">
            <SlidersHorizontalIcon className="size-3.5" />
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-52 gap-0 p-1">
        <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">Filter</p>
        <MenuCheck active={hideWhitespaceOnly} onClick={onToggleWhitespace} disabled={pending}>
          Hide whitespace-only
        </MenuCheck>
        <MenuCheck active={collapseGeneratedFiles} onClick={onToggleGenerated} disabled={pending}>
          Collapse generated
        </MenuCheck>
      </PopoverContent>
    </Popover>
  )
}

function ReviewPopover({
  pending,
  state,
  onComment,
  onRequestChanges,
  onApprove,
}: {
  pending: boolean
  state: CradleDiffReview['reviewState']
  onComment: () => void
  onRequestChanges: () => void
  onApprove: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button size="sm" className="h-7 text-[12px]" disabled={pending}>
            Review
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-52 gap-0 p-1">
        <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
          {state === 'approved'
            ? 'You approved this review'
            : state === 'changes-requested'
              ? 'You requested changes'
              : 'Submit your review'}
        </p>
        <div className="my-1 h-px bg-border/60" />
        <MenuRow onClick={onComment} icon={<MessageSquareIcon className="size-3.5" />} disabled={pending}>
          Comment
        </MenuRow>
        <MenuRow onClick={onRequestChanges} icon={<SendIcon className="size-3.5" />} disabled={pending}>
          Request changes
        </MenuRow>
        <MenuRow onClick={onApprove} icon={<CheckIcon className="size-3.5" />} disabled={pending} emphasis>
          Approve
        </MenuRow>
      </PopoverContent>
    </Popover>
  )
}

function MenuRow({
  onClick,
  icon,
  disabled,
  emphasis,
  children,
}: {
  onClick: () => void
  icon: React.ReactNode
  disabled?: boolean
  emphasis?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
    >
      {icon}
      <span className={cn('flex-1', emphasis ? 'font-medium text-foreground' : 'text-foreground/80')}>
        {children}
      </span>
    </button>
  )
}

function MenuCheck({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] text-foreground/80 transition-colors hover:bg-muted disabled:opacity-50"
    >
      <span
        className={cn(
          'flex size-3.5 items-center justify-center rounded-[3px] border',
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}
      >
        {active && <CheckIcon className="size-2.5" />}
      </span>
      <span className="flex-1">{children}</span>
    </button>
  )
}
