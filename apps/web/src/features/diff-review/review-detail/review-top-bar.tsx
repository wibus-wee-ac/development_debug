import {
  CheckIcon,
  GitCommitVerticalIcon,
  ListTreeIcon,
  MessageSquareIcon,
  RefreshCwIcon,
  Rows3Icon,
  SendIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from 'lucide-react'
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
  onPreference: (input: { fontSize?: number, hideWhitespaceOnly?: boolean, collapseGeneratedFiles?: boolean }) => void
  preferencePending: boolean
  onSubmit: (decision: ReviewDecision, bodyMarkdown: string) => void
  submitPending: boolean
  onRefresh: () => void
  refreshPending: boolean
  isFetching: boolean
  onOpenGuide: () => void
  hasGuide: boolean
}

const REVIEW_STATE_TONE: Record<CradleDiffReview['reviewState'], string> = {
  'unreviewed': 'bg-muted-foreground/30',
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
}: ReviewTopBarProps) {
  const [isDiffStylePending, startDiffStyleTransition] = useTransition()
  const refreshing = refreshPending || isFetching
  const fontSize = review.preferences.fontSize ?? 11

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 px-4" data-testid="review-top-bar">
      {/* Identity: a single line of context, nothing competing for attention. */}
      <span className={cn('size-2 shrink-0 rounded-full', REVIEW_STATE_TONE[review.reviewState])} aria-hidden />
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium text-foreground">{review.title}</h1>
        <p className="truncate text-[11px] tabular-nums text-muted-foreground">
          {sourceLabel(review.sourceKind)}
          {' · '}
          {formatChangeStats(review)}
        </p>
      </div>

      <div className="flex-1" />

      {/* Guide is always reachable; generation is opt-in inside the view (it costs tokens). */}
      <Button variant="ghost" size="sm" onClick={onOpenGuide} className="gap-1.5 text-xs">
        <ListTreeIcon className="size-3.5" />
        Guide
        {hasGuide && <span className="size-1.5 rounded-full bg-emerald-500" aria-label="Guide generated" />}
      </Button>

      <DisplayPopover
        diffStyle={diffStyle}
        fontSize={fontSize}
        hideWhitespaceOnly={review.preferences.hideWhitespaceOnly}
        collapseGeneratedFiles={review.preferences.collapseGeneratedFiles}
        pending={preferencePending || isDiffStylePending}
        onDiffStyle={(style) => {
          startDiffStyleTransition(() => onDiffStyleChange(style))
        }}
        onFont={size => onPreference({ fontSize: size })}
        onToggleWhitespace={() => onPreference({ hideWhitespaceOnly: !review.preferences.hideWhitespaceOnly })}
        onToggleGenerated={() => onPreference({ collapseGeneratedFiles: !review.preferences.collapseGeneratedFiles })}
      />

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

/** Display options tucked away — layout + readability controls don't belong in the chrome line. */
function DisplayPopover({
  diffStyle,
  fontSize,
  hideWhitespaceOnly,
  collapseGeneratedFiles,
  pending,
  onDiffStyle,
  onFont,
  onToggleWhitespace,
  onToggleGenerated,
}: {
  diffStyle: DiffStyle
  fontSize: number
  hideWhitespaceOnly: boolean
  collapseGeneratedFiles: boolean
  pending: boolean
  onDiffStyle: (style: DiffStyle) => void
  onFont: (size: number) => void
  onToggleWhitespace: () => void
  onToggleGenerated: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" disabled={pending}>
            <SlidersHorizontalIcon className="size-3.5" />
            Display
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-64 gap-3">
        <section className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Layout</p>
          <div className="grid grid-cols-2 gap-1.5">
            <LayoutButton active={diffStyle === 'unified'} onClick={() => onDiffStyle('unified')} icon={<Rows3Icon className="size-3.5" />}>
              Unified
            </LayoutButton>
            <LayoutButton active={diffStyle === 'split'} onClick={() => onDiffStyle('split')} icon={<GitCommitVerticalIcon className="size-3.5" />}>
              Split
            </LayoutButton>
          </div>
        </section>

        <section className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Font size</p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 flex-1" onClick={() => onFont(Math.max(9, fontSize - 1))} disabled={pending}>
              A−
            </Button>
            <span className="w-8 text-center text-[11px] tabular-nums text-muted-foreground">
{fontSize}
px
            </span>
            <Button variant="outline" size="sm" className="h-7 flex-1" onClick={() => onFont(Math.min(24, fontSize + 1))} disabled={pending}>
              A+
            </Button>
          </div>
        </section>

        <section className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Filter</p>
          <CheckRow active={hideWhitespaceOnly} onClick={onToggleWhitespace} disabled={pending}>
            Hide whitespace-only changes
          </CheckRow>
          <CheckRow active={collapseGeneratedFiles} onClick={onToggleGenerated} disabled={pending}>
            Collapse generated files
          </CheckRow>
        </section>
      </PopoverContent>
    </Popover>
  )
}

/** Submit review: the three decisions, gathered so the chrome stays calm. */
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
          <Button variant="default" size="sm" className="gap-1.5 text-xs" disabled={pending}>
            <Settings2Icon className="size-3.5" />
            Review
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-56 gap-1">
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">
          {state === 'approved' ? 'You approved this review' : state === 'changes-requested' ? 'You requested changes' : 'Submit your review'}
        </p>
        <ReviewAction icon={<MessageSquareIcon className="size-3.5" />} onClick={onComment}>
          Comment
        </ReviewAction>
        <ReviewAction icon={<SendIcon className="size-3.5" />} onClick={onRequestChanges}>
          Request changes
        </ReviewAction>
        <ReviewAction icon={<CheckIcon className="size-3.5" />} onClick={onApprove} emphasis>
          Approve
        </ReviewAction>
      </PopoverContent>
    </Popover>
  )
}

function LayoutButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-8 items-center justify-center gap-1.5 rounded-md text-xs transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function CheckRow({
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
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs text-foreground transition-colors hover:bg-muted/60"
    >
      <span
        className={cn(
          'flex size-4 items-center justify-center rounded border',
          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}
      >
        {active && <CheckIcon className="size-3" />}
      </span>
      {children}
    </button>
  )
}

function ReviewAction({
  icon,
  onClick,
  children,
  emphasis,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  emphasis?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
        emphasis ? 'font-medium text-foreground' : 'text-foreground/80',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
