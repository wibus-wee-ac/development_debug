import {
  GitCommitLine as GitCommitVerticalIcon,
  GitCompareLine as GitCompareIcon,
  GitPullRequestLine as GitPullRequestArrowIcon,
  LoadingLine as Loader2Icon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  postWorkspacesByIdDiffReviewsLocalBranchCompare,
  postWorkspacesByIdDiffReviewsLocalCommit,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

import { GitRefPicker } from './git-ref-picker'
import {
  formatChangeStats,
  reviewListQueryKey,
  reviewNeedsAttention,
  sourceLabel,
} from './shared/diff-items'
import { navigateToReview } from './shared/navigation'
import type { CradleDiffReview } from './shared/types'
import { WORKING_TREE_REVIEW_ID } from './shared/types'
import type { ReviewsListTab } from './shared/use-review-list'
import { useReviewList } from './shared/use-review-list'

interface ReviewsListPageProps {
  workspaceId: string
  repositoryPath?: string | null
}

const LIST_TABS: Array<{ id: ReviewsListTab, label: string }> = [
  { id: 'for-me', label: 'For me' },
  { id: 'created', label: 'Created' },
  { id: 'all', label: 'All' },
]

export function ReviewsListPage({
  workspaceId,
  repositoryPath,
}: ReviewsListPageProps) {
  const { reviews, isLoading, isError, countForTab, groupsForTab } = useReviewList(workspaceId)
  const [tab, setTab] = useState<ReviewsListTab>('for-me')
  const queryClient = useQueryClient()

  const compareMutation = useMutation({
    mutationFn: async (input: { baseRef: string, headRef: string }) => {
      const { data } = await postWorkspacesByIdDiffReviewsLocalBranchCompare({
        path: { id: workspaceId },
        body: {
          repo: repositoryPath ?? undefined,
          baseRef: input.baseRef,
          headRef: input.headRef,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
      navigateToReview(workspaceId, data.id, { repositoryPath })
    },
  })

  const commitMutation = useMutation({
    mutationFn: async (input: { commitRef: string }) => {
      const { data } = await postWorkspacesByIdDiffReviewsLocalCommit({
        path: { id: workspaceId },
        body: {
          repo: repositoryPath ?? undefined,
          commitRef: input.commitRef,
        },
        throwOnError: true,
      })
      return data
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: reviewListQueryKey(workspaceId) })
      navigateToReview(workspaceId, data.id, { repositoryPath })
    },
  })

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="reviews-list-page">
      <header className="flex h-10 shrink-0 items-center gap-2 px-4">
        <h1 className="text-[13px] font-semibold text-foreground">Reviews</h1>
        <span className="text-[12px] tabular-nums text-muted-foreground">{reviews.length}</span>
        <div className="flex-1" />
        <CommitDialog
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          onOpen={input => commitMutation.mutate(input)}
          pending={commitMutation.isPending}
        />
        <CompareDialog
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          onCompare={input => compareMutation.mutate(input)}
          pending={compareMutation.isPending}
        />
      </header>

      <div className="flex shrink-0 items-center gap-1 px-4 pb-2">
        {LIST_TABS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors',
              tab === item.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {item.label}
            <span className="ml-1.5 tabular-nums text-muted-foreground/70">{countForTab(item.id)}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {isLoading
          ? (
              <div className="flex h-full items-center justify-center">
                <Loader2Icon className="size-4 animate-spin !text-muted-foreground/40" aria-hidden />
              </div>
            )
          : isError
            ? (
                <p className="py-10 text-center text-[12px] text-muted-foreground">Reviews unavailable</p>
              )
            : (
                <ReviewsContent
                  workspaceId={workspaceId}
                  repositoryPath={repositoryPath}
                  tab={tab}
                  reviews={reviews}
                  groupsForTab={groupsForTab}
                />
              )}
      </div>
    </div>
  )
}

function ReviewsContent({
  workspaceId,
  repositoryPath,
  tab,
  reviews,
  groupsForTab,
}: {
  workspaceId: string
  repositoryPath?: string | null
  tab: ReviewsListTab
  reviews: CradleDiffReview[]
  groupsForTab: (tab: ReviewsListTab) => Array<{ id: string, label: string, reviews: CradleDiffReview[] }>
}) {
  return (
    <>
      {/* Working tree is always reachable as the primary entry — it is the live local review. */}
      <WorkingTreeEntry
        workspaceId={workspaceId}
        repositoryPath={repositoryPath}
        present={reviews.some(review => review.sourceKind === 'local-working-tree')}
      />

      {groupsForTab(tab).length === 0 && reviews.length === 0
        ? (
            <div className="py-16 text-center">
              <GitPullRequestArrowIcon className="mx-auto size-5 !text-muted-foreground/30" aria-hidden />
              <p className="mt-2 text-[12px] text-muted-foreground">No reviews yet</p>
            </div>
          )
        : (
            <div className="mt-2 space-y-5">
              {groupsForTab(tab).map(group => (
                <section key={group.id}>
                  <h2 className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{group.label}</h2>
                  <div className="space-y-px">
                    {group.reviews.map(review => (
                      <ReviewRow
                        key={review.id}
                        review={review}
                        onClick={() => navigateToReview(workspaceId, review.id, { repositoryPath })}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
    </>
  )
}

function WorkingTreeEntry({
  workspaceId,
  repositoryPath,
  present,
}: {
  workspaceId: string
  repositoryPath?: string | null
  present: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => navigateToReview(workspaceId, WORKING_TREE_REVIEW_ID, { repositoryPath })}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        'bg-muted/50 hover:bg-muted',
      )}
      data-testid="reviews-working-tree-entry"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-background text-foreground">
        <PlusIcon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">Working tree</span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {present ? 'Review your uncommitted changes' : 'No uncommitted changes detected'}
        </span>
      </span>
      <span className="text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        Open
      </span>
    </button>
  )
}

function ReviewRow({ review, onClick }: { review: CradleDiffReview, onClick: () => void }) {
  const openThreads = review.threads.filter(thread => thread.state === 'open').length
  const unviewed = review.files.filter(file => !file.isViewed).length
  const needsAttention = reviewNeedsAttention(review)

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60"
      data-testid="reviews-list-row"
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          review.status === 'open' ? (needsAttention ? 'bg-orange-500' : 'bg-emerald-500') : 'bg-muted-foreground/40',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{review.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {sourceLabel(review.sourceKind)}
{' '}
·
{formatChangeStats(review)}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {unviewed > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
            {unviewed}
{' '}
unviewed
          </span>
        )}
        {openThreads > 0 && (
          <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[11px] tabular-nums text-orange-600 dark:text-orange-400">
            {openThreads}
{' '}
open
          </span>
        )}
      </div>
    </button>
  )
}

function CommitDialog({
  workspaceId,
  repositoryPath,
  onOpen,
  pending,
}: {
  workspaceId: string
  repositoryPath?: string | null
  onOpen: (input: { commitRef: string }) => void
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [commitRef, setCommitRef] = useState('')

  const reset = () => {
    setCommitRef('')
  }

  const submit = () => {
    if (!commitRef.trim() || pending) {
      return
    }
    onOpen({ commitRef: commitRef.trim() })
    setOpen(false)
    reset()
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset() } }}>
      <PopoverTrigger
        render={(
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]">
            <GitCommitVerticalIcon className="size-3.5" aria-hidden />
            Commit
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={commitRef}
          onValueChange={setCommitRef}
          autoFocus
          quickRefs={['HEAD', 'HEAD~1']}
          placeholder="Search branches, commits, or type a ref…"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-[12px]" disabled={!commitRef.trim() || pending} onClick={submit}>
            {pending && <Loader2Icon className="size-3.5 animate-spin" />}
            Open
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CompareDialog({
  workspaceId,
  repositoryPath,
  onCompare,
  pending,
}: {
  workspaceId: string
  repositoryPath?: string | null
  onCompare: (input: { baseRef: string, headRef: string }) => void
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [baseRef, setBaseRef] = useState('main')
  const [headRef, setHeadRef] = useState('')

  const reset = () => {
    setBaseRef('main')
    setHeadRef('')
  }

  const submit = () => {
    if (!baseRef.trim() || !headRef.trim() || pending) {
      return
    }
    onCompare({ baseRef: baseRef.trim(), headRef: headRef.trim() })
    setOpen(false)
    reset()
  }

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { reset() } }}>
      <PopoverTrigger
        render={(
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]">
            <GitCompareIcon className="size-3.5" aria-hidden />
            Compare
          </Button>
        )}
      />
      <PopoverContent align="end" className="w-80 gap-2 p-3">
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={baseRef}
          onValueChange={setBaseRef}
          autoFocus
          quickRefs={['main', 'master', 'HEAD']}
          placeholder="Base ref — search or type…"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <GitRefPicker
          workspaceId={workspaceId}
          repositoryPath={repositoryPath}
          value={headRef}
          onValueChange={setHeadRef}
          quickRefs={['HEAD']}
          placeholder="Head ref — search or type…"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit()
            }
          }}
        />
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-[12px]"
            disabled={!baseRef.trim() || !headRef.trim() || pending}
            onClick={submit}
          >
            {pending && <Loader2Icon className="size-3.5 animate-spin" />}
            Open
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
