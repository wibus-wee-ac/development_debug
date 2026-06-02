/**
 * Output: Codex-style review mode target picker for the /review slash command.
 * Input: Workspace Git queries and callbacks for submitting generated review prompts.
 * Position: Chat feature UI for Codex host-owned review slash command behavior.
 */

import { ArrowLeftIcon, CheckCircle2Icon, GitBranchIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { GetWorkspacesByIdGitBranchesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { useGitBranches, useGitStatus } from '~/features/git/use-git'
import { cn } from '~/lib/cn'

import {
  buildCodexReviewPrompt,
  createCodexReviewBranchLines,
} from './codex-review-mode'

export interface CodexReviewModeDialogProps {
  open: boolean
  workspaceId: string | null | undefined
  onOpenChange: (open: boolean) => void
  onSubmitPrompt: (prompt: string) => void
  resolveMergeBase: (baseBranch: string) => Promise<string | null>
}

type ReviewStep = 'choose-target' | 'choose-base'

export function CodexReviewModeDialog({
  open,
  workspaceId,
  onOpenChange,
  onSubmitPrompt,
  resolveMergeBase,
}: CodexReviewModeDialogProps) {
  const [step, setStep] = useState<ReviewStep>('choose-target')
  const [submittingBranchName, setSubmittingBranchName] = useState<string | null>(null)
  const [submittingUncommitted, setSubmittingUncommitted] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const statusQuery = useGitStatus(open ? workspaceId : null)
  const branchesQuery = useGitBranches(open ? workspaceId : null)
  const currentBranch = statusQuery.data?.branch ?? null
  const branchLines = useMemo(() => createCodexReviewBranchLines({
    branches: branchesQuery.data as GetWorkspacesByIdGitBranchesResponse | null | undefined,
    currentBranch,
  }), [branchesQuery.data, currentBranch])
  const loadingBaseBranches = branchesQuery.isLoading || statusQuery.isLoading

  function resetDialog(openState: boolean) {
    onOpenChange(openState)
    if (!openState) {
      setStep('choose-target')
      setSubmittingBranchName(null)
      setSubmittingUncommitted(false)
      setErrorText(null)
    }
  }

  function submitUncommittedReview() {
    setErrorText(null)
    setSubmittingUncommitted(true)
    try {
      onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'uncommitted',
        sourceBranch: currentBranch ?? 'HEAD',
      }))
      resetDialog(false)
    }
    finally {
      setSubmittingUncommitted(false)
    }
  }

  async function submitBaseBranchReview(baseBranch: string) {
    setErrorText(null)
    setSubmittingBranchName(baseBranch)
    try {
      const mergeBaseSha = await resolveMergeBase(baseBranch)
      if (!mergeBaseSha) {
        throw new Error(`Failed to resolve a merge base between HEAD and ${baseBranch}.`)
      }
      onSubmitPrompt(buildCodexReviewPrompt({
        mode: 'base-branch',
        sourceBranch: currentBranch ?? 'HEAD',
        baseBranch,
        mergeBaseSha,
      }))
      resetDialog(false)
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to start code review.')
    }
    finally {
      setSubmittingBranchName(null)
    }
  }

  const hasWorkspace = Boolean(workspaceId)
  const gitUnavailable = statusQuery.isError || branchesQuery.isError

  return (
    <Dialog open={open} onOpenChange={resetDialog}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] max-w-none gap-3 rounded-xl p-4" data-testid="codex-review-mode-dialog">
        <DialogHeader>
          <DialogTitle>Code review</DialogTitle>
          <DialogDescription>
            Choose the changes Codex should review.
          </DialogDescription>
        </DialogHeader>

        {!hasWorkspace && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Open a workspace-backed Codex chat before starting review mode.
          </div>
        )}

        {gitUnavailable && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span>Git repository unavailable.</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                void statusQuery.refetch()
                void branchesQuery.refetch()
              }}
            >
              <RefreshCwIcon className="size-3" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}

        {errorText && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errorText}
          </div>
        )}

        {step === 'choose-target'
          ? (
              <div className="grid gap-2">
                <ReviewOptionButton
                  title="Review uncommitted changes"
                  description="Staged, unstaged, and untracked files"
                  disabled={!hasWorkspace || gitUnavailable || submittingUncommitted}
                  loading={submittingUncommitted}
                  onClick={submitUncommittedReview}
                />
                <ReviewOptionButton
                  title="Review against a base branch"
                  description={currentBranch ? `Compare ${currentBranch} with a selected branch` : 'Compare HEAD with a selected branch'}
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
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setStep('choose-target')}
                >
                  <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                  Back
                </Button>
                <ScrollArea className="max-h-72 rounded-lg border border-border/70" viewportClassName="max-h-72">
                  <div className="grid gap-1 p-1">
                    {branchLines.length === 0 && !loadingBaseBranches && (
                      <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                        No base branches found.
                      </div>
                    )}
                    {loadingBaseBranches && (
                      <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
                        <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
                        Loading branches
                      </div>
                    )}
                    {branchLines.map(branch => (
                      <button
                        key={branch.key}
                        type="button"
                        disabled={submittingBranchName !== null}
                        onClick={() => void submitBaseBranchReview(branch.label)}
                        className={cn(
                          'flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
                          submittingBranchName === branch.label && 'bg-muted',
                        )}
                      >
                        <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{branch.label}</span>
                        {submittingBranchName === branch.label && (
                          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

        <DialogFooter variant="bare">
          <Button type="button" variant="outline" onClick={() => resetDialog(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      className="flex min-h-14 items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
    >
      <Icon className={cn('size-4 shrink-0 text-muted-foreground', loading && 'animate-spin')} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
