import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CirclePauseIcon,
  CircleSlashIcon,
  GaugeIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PencilIcon,
  RefreshCwIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { GetWorkspacesByIdGitBranchesResponse } from '~/api-gen/types.gen'
import { Progress } from '~/components/ui/progress'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useGitBranches, useGitStatus } from '~/features/git/use-git'
import { cn } from '~/lib/cn'
import { clampPercent, formatElapsedSeconds } from '~/lib/number-format'

import type {
  ChatRuntimeGoalUiSlotState,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotState,
} from './chat-capabilities'
import {
  buildCodexReviewPrompt,
  createCodexReviewBranchLines,
} from './codex-review-mode'

interface ComposerSlotStatesProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  actions?: ComposerGoalSlotActions
  review?: ComposerReviewSlotActions
  className?: string
}

export interface ComposerGoalSlotActions {
  busy?: boolean
  onEdit?: (state: ChatRuntimeGoalUiSlotState) => void
  onPause?: (state: ChatRuntimeGoalUiSlotState) => void
  onResume?: (state: ChatRuntimeGoalUiSlotState) => void
  onClear?: (state: ChatRuntimeGoalUiSlotState) => void
}

export interface ComposerReviewSlotActions {
  open: boolean
  workspaceId?: string | null
  onDismiss: () => void
  onSubmitPrompt: (prompt: string) => void
  resolveMergeBase: (baseBranch: string) => Promise<string | null>
}

type ReviewStep = 'choose-target' | 'choose-base'

export function ComposerSlotStates({ slots, states, actions, review, className }: ComposerSlotStatesProps) {
  const composerSlotIds = new Set(
    slots.filter(slot => slot.surfaces.includes('composerState')).map(slot => slot.id),
  )
  const goalState = states.find((state): state is ChatRuntimeGoalUiSlotState => {
    return state.kind === 'goal' && composerSlotIds.has(state.slotId)
  })

  if (!goalState && !review?.open) {
    return null
  }

  return (
    <>
      {goalState && <GoalSlotState state={goalState} actions={actions} className={className} />}
      {review?.open && <ReviewSlotState review={review} className={className} />}
    </>
  )
}

function ReviewSlotState({
  review,
  className,
}: {
  review: ComposerReviewSlotActions
  className?: string
}) {
  const [step, setStep] = useState<ReviewStep>('choose-target')
  const [submittingBranchName, setSubmittingBranchName] = useState<string | null>(null)
  const [submittingUncommitted, setSubmittingUncommitted] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const statusQuery = useGitStatus(review.open ? review.workspaceId : null)
  const branchesQuery = useGitBranches(review.open ? review.workspaceId : null)
  const currentBranch = statusQuery.data?.branch ?? null
  const branchLines = useMemo(() => createCodexReviewBranchLines({
    branches: branchesQuery.data as GetWorkspacesByIdGitBranchesResponse | null | undefined,
    currentBranch,
  }), [branchesQuery.data, currentBranch])
  const loadingBaseBranches = branchesQuery.isLoading || statusQuery.isLoading
  const hasWorkspace = Boolean(review.workspaceId)
  const gitUnavailable = statusQuery.isError || branchesQuery.isError
  const busy = submittingUncommitted || submittingBranchName !== null

  function dismissReview() {
    if (busy) {
      return
    }
    review.onDismiss()
  }

  function submitUncommittedReview() {
    setErrorText(null)
    setSubmittingUncommitted(true)
    try {
      review.onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'uncommitted',
        sourceBranch: currentBranch ?? 'HEAD',
      }))
      review.onDismiss()
    }
    finally {
      setSubmittingUncommitted(false)
    }
  }

  async function submitBaseBranchReview(baseBranch: string) {
    setErrorText(null)
    setSubmittingBranchName(baseBranch)
    try {
      const mergeBaseSha = await review.resolveMergeBase(baseBranch)
      if (!mergeBaseSha) {
        throw new Error(`Failed to resolve a merge base between HEAD and ${baseBranch}.`)
      }
      review.onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'base-branch',
        sourceBranch: currentBranch ?? 'HEAD',
        baseBranch,
        mergeBaseSha,
      }))
      review.onDismiss()
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to start code review.')
    }
    finally {
      setSubmittingBranchName(null)
    }
  }

  return (
    <div
      className={cn(
        'pointer-events-auto relative z-0 mx-2 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none px-3 py-2 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
        'dark:shadow-[0_-8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
        className,
      )}
      data-chat-runtime-slot-state="review"
      data-testid="codex-review-mode-slot"
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      <div className="mb-2 flex h-6 min-w-0 items-center gap-2">
        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-foreground/80">Code review</span>
          <span className="ml-1.5 text-muted-foreground">
            {step === 'choose-base' ? 'Choose base branch' : 'Choose target'}
          </span>
        </div>
        <GoalIconAction label="Close review picker" disabled={busy} onClick={dismissReview}>
          <XIcon className="size-3.5" aria-hidden="true" />
        </GoalIconAction>
      </div>

      {!hasWorkspace && (
        <ReviewSlotNotice tone="danger">
          Open a workspace-backed Codex chat before starting review mode.
        </ReviewSlotNotice>
      )}

      {gitUnavailable && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <span>Git repository unavailable.</span>
          <button
            type="button"
            onClick={() => {
              void statusQuery.refetch()
              void branchesQuery.refetch()
            }}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <RefreshCwIcon className="size-3" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {errorText && (
        <ReviewSlotNotice tone="danger">
          {errorText}
        </ReviewSlotNotice>
      )}

      {step === 'choose-target'
        ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <ReviewOptionButton
                title="Review uncommitted changes"
                description="Staged, unstaged, and untracked files"
                disabled={!hasWorkspace || gitUnavailable || submittingUncommitted}
                loading={submittingUncommitted}
                onClick={submitUncommittedReview}
              />
              <ReviewOptionButton
                title="Review against base branch"
                description={currentBranch ? `Compare ${currentBranch} with another branch` : 'Compare HEAD with another branch'}
                disabled={!hasWorkspace || gitUnavailable || loadingBaseBranches}
                loading={loadingBaseBranches}
                onClick={() => {
                  setErrorText(null)
                  setStep('choose-base')
                }}
              />
            </div>
          )
        : (
            <div className="grid gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep('choose-target')}
                className="inline-flex h-7 w-fit items-center gap-1 rounded-sm px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
              >
                <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                Back
              </button>
              <ScrollArea className="max-h-44 rounded-md border border-border/70" viewportClassName="max-h-44">
                <div className="grid gap-1 p-1">
                  {branchLines.length === 0 && !loadingBaseBranches && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                      No base branches found.
                    </div>
                  )}
                  {loadingBaseBranches && (
                    <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                      <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
                      Loading branches
                    </div>
                  )}
                  {branchLines.map(branch => (
                    <button
                      key={branch.key}
                      type="button"
                      disabled={busy}
                      onClick={() => void submitBaseBranchReview(branch.label)}
                      className={cn(
                        'flex h-8 min-w-0 items-center gap-2 rounded-sm px-2 text-left text-xs transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
                        submittingBranchName === branch.label && 'bg-muted',
                      )}
                    >
                      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-foreground/85">{branch.label}</span>
                      {submittingBranchName === branch.label && (
                        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
    </div>
  )
}

function ReviewSlotNotice({
  tone,
  children,
}: {
  tone: 'danger'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'mb-2 rounded-md border px-2.5 py-2 text-xs',
        tone === 'danger' && 'border-destructive/20 bg-destructive/5 text-destructive',
      )}
    >
      {children}
    </div>
  )
}

function ReviewOptionButton({
  title,
  description,
  disabled,
  loading,
  onClick,
}: {
  title: string
  description: string
  disabled: boolean
  loading?: boolean
  onClick: () => void
}) {
  const Icon = loading ? LoaderCircleIcon : CheckCircle2Icon
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 min-w-0 items-center gap-2 rounded-md border border-border/70 px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
    >
      <Icon className={cn('size-3.5 shrink-0 text-muted-foreground', loading && 'animate-spin')} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function GoalSlotState({
  state,
  actions,
  className,
}: {
  state: ChatRuntimeGoalUiSlotState
  actions?: ComposerGoalSlotActions
  className?: string
}) {
  const budgetPercent = readGoalBudgetPercent(state)
  const statusToneClassName = readGoalStatusToneClassName(state.status)
  const displayedTimeUsedSeconds = useDisplayedGoalTimeUsedSeconds(state)
  const elapsedLabel = formatElapsedSeconds(displayedTimeUsedSeconds)
  const goalStatusAction = readGoalStatusAction(state.status)

  return (
    <div
      className={cn(
        'pointer-events-auto relative z-0 mx-2 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none px-3 py-1.5 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
        'dark:shadow-[0_-8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
        className,
      )}
      data-chat-runtime-slot-state="goal"
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      <div className="flex h-6 min-w-0 items-center gap-2">
        <TargetIcon className={cn('size-3.5 shrink-0', statusToneClassName)} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground/75">
            {readGoalStatusHeading(state.status)}
          </span>
          <span className="min-w-0 truncate text-foreground/80">{state.objective}</span>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
            {elapsedLabel}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <GoalIconAction
            label="Edit goal"
            disabled={!actions?.onEdit || actions.busy}
            onClick={() => actions?.onEdit?.(state)}
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
          </GoalIconAction>
          {goalStatusAction && (
            <GoalIconAction
              label={goalStatusAction.label}
              disabled={actions?.busy || (goalStatusAction.kind === 'resume' ? !actions?.onResume : !actions?.onPause)}
              onClick={() => {
                if (goalStatusAction.kind === 'resume') {
                  actions?.onResume?.(state)
                  return
                }
                actions?.onPause?.(state)
              }}
            >
              {renderGoalStatusIcon(state.status)}
            </GoalIconAction>
          )}
          <GoalIconAction
            label="Clear goal"
            disabled={!actions?.onClear || actions.busy}
            onClick={() => actions?.onClear?.(state)}
          >
            <Trash2Icon className="size-3.5" aria-hidden="true" />
          </GoalIconAction>
        </div>
      </div>
      {budgetPercent !== null && (
        <div className="flex items-center gap-2 pl-5">
          <Progress value={budgetPercent} className="h-0.5 flex-1 bg-muted/60" />
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {state.tokensUsed}
            /
            {state.tokenBudget}
          </span>
        </div>
      )}
    </div>
  )
}

function useDisplayedGoalTimeUsedSeconds(state: ChatRuntimeGoalUiSlotState): number {
  const isActive = state.status === 'active'
  const nowSeconds = useGoalDisplayNowSeconds(isActive)
  const baseTimeUsedSeconds = Math.max(0, Math.floor(state.timeUsedSeconds))

  if (!isActive) {
    return baseTimeUsedSeconds
  }

  return baseTimeUsedSeconds + Math.max(0, nowSeconds - Math.floor(state.updatedAt))
}

function useGoalDisplayNowSeconds(active: boolean): number {
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1_000))

  useEffect(() => {
    if (!active) {
      return
    }

    const intervalId = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1_000))
    }, 1_000)

    return () => window.clearInterval(intervalId)
  }, [active])

  return nowSeconds
}

function GoalIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/75 transition-[background-color,color,opacity,transform] hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function readGoalBudgetPercent(state: ChatRuntimeGoalUiSlotState): number | null {
  if (state.tokenBudget === null || state.tokenBudget <= 0) {
    return null
  }
  return clampPercent((state.tokensUsed / state.tokenBudget) * 100)
}

function renderGoalStatusIcon(status: ChatRuntimeGoalUiSlotState['status']) {
  switch (status) {
    case 'complete':
      return <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
    case 'paused':
      return <GaugeIcon className="size-3.5" aria-hidden="true" />
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return <CircleSlashIcon className="size-3.5" aria-hidden="true" />
    case 'active':
    default:
      return <CirclePauseIcon className="size-3.5" aria-hidden="true" />
  }
}

function readGoalStatusAction(status: ChatRuntimeGoalUiSlotState['status']): { kind: 'pause' | 'resume', label: string } | null {
  switch (status) {
    case 'active':
      return { kind: 'pause', label: 'Pause goal' }
    case 'paused':
      return { kind: 'resume', label: 'Resume goal' }
    case 'blocked':
    case 'budgetLimited':
    case 'complete':
    case 'usageLimited':
    default:
      return null
  }
}

function readGoalStatusHeading(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'Completed goal'
    case 'paused':
      return 'Paused goal'
    case 'blocked':
      return 'Blocked goal'
    case 'usageLimited':
      return 'Usage-limited goal'
    case 'budgetLimited':
      return 'Budget-limited goal'
    case 'active':
    default:
      return 'Active goal'
  }
}

function readGoalStatusToneClassName(status: ChatRuntimeGoalUiSlotState['status']): string {
  switch (status) {
    case 'complete':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'blocked':
    case 'usageLimited':
    case 'budgetLimited':
      return 'text-destructive'
    case 'paused':
      return 'text-amber-600 dark:text-amber-400'
    case 'active':
    default:
      return 'text-muted-foreground'
  }
}
