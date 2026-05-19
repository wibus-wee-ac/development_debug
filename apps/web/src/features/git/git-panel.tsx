// Input: useGitGraph, useGitStatus, computeGraphLayout, GitGraphRow, BranchPicker, postWorkspacesByIdGitFetch, VList from virtua
// Output: GitPanel — full git panel with branch status bar, fetch button, and virtualized commit graph with infinite scroll
// Position: Rendered inside right-aside "Git" tab; consumes HTTP git API

import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon, GitGraphIcon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { VListHandle } from 'virtua'
import { VList } from 'virtua'

import { postWorkspacesByIdGitFetch } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { TooltipProvider } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { BranchPicker } from './branch-picker'
import { GitGraphRow, ROW_HEIGHT } from './git-graph-row'
import { computeGraphLayout } from './graph-layout'
import { gitBranchesQueryKey, gitGraphQueryKey, gitStatusQueryKey, useGitGraph, useGitStatus } from './use-git'

interface GitPanelProps {
  workspaceId: string | null | undefined
}

export function GitPanel({ workspaceId }: GitPanelProps) {
  const { data: status, isLoading: statusLoading, isError: statusError } = useGitStatus(workspaceId)
  const [limit, setLimit] = useState(100)
  const { data: commits, isLoading: graphLoading, isFetching: graphFetching } = useGitGraph(workspaceId, limit)
  const [fetching, setFetching] = useState(false)
  const queryClient = useQueryClient()

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey({ path: { id: workspaceId! } }) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey({ path: { id: workspaceId! } }) })
    // Omit query.limit to fuzzy-match all limit variants for this workspace
    void queryClient.invalidateQueries({ queryKey: gitGraphQueryKey({ path: { id: workspaceId! } }) })
  }, [queryClient, workspaceId])

  const handleFetch = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    setFetching(true)
    try {
      await postWorkspacesByIdGitFetch({ path: { id: workspaceId } })
      invalidateAll()
    }
    finally {
      setFetching(false)
    }
  }, [workspaceId, invalidateAll])

  const vListRef = useRef<VListHandle>(null)

  const handleRangeChange = useCallback((_offset: number) => {
    const handle = vListRef.current
    if (handle && commits && !graphFetching) {
      if (_offset + handle.viewportSize >= handle.scrollSize - handle.viewportSize * 0.5) {
        setLimit(prev => prev + 100)
      }
    }
  }, [commits, graphFetching])

  const layoutCommits = useMemo(
    () => (commits ? computeGraphLayout(commits) : []),
    [commits],
  )

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="git-panel-empty-workspace">
        <p className="text-xs text-muted-foreground">请先选择 Workspace</p>
      </div>
    )
  }

  if (statusError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center" data-testid="git-panel-error">
        <div className="flex flex-col items-center gap-2">
          <GitGraphIcon className="size-5 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">不是 Git 仓库或无权限</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="git-panel">
      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1" data-testid="git-panel-status-bar">
        {statusLoading
          ? (
            <div className="h-5 w-24 animate-pulse rounded bg-muted/60" />
          )
          : status
            ? (
              <BranchPicker
                workspaceId={workspaceId}
                currentBranch={status.branch}
              >
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
                    'text-foreground/80 hover:text-foreground hover:bg-accent/60',
                  )}
                  data-testid="git-panel-branch-trigger"
                  data-branch-name={status.branch}
                >
                  <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="max-w-28 truncate font-medium">{status.branch}</span>
                  {status.ahead > 0 && (
                    <span className="flex items-center gap-px text-[10px] text-primary font-medium tabular-nums">
                      <ArrowUpIcon className="size-2.5" aria-hidden />
                      {status.ahead}
                    </span>
                  )}
                  {status.behind > 0 && (
                    <span className="flex items-center gap-px text-[10px] text-amber-500 font-medium tabular-nums">
                      <ArrowDownIcon className="size-2.5" aria-hidden />
                      {status.behind}
                    </span>
                  )}
                </button>
              </BranchPicker>
            )
            : null}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Fetch git updates"
          title="Fetch all (--all --prune)"
          onClick={() => { void handleFetch() }}
          disabled={fetching}
          className="text-muted-foreground hover:text-foreground"
          data-testid="git-panel-fetch"
        >
          <RefreshCwIcon className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {/* Commit graph */}
      {graphLoading
        ? (
          <div className="flex flex-1 items-center justify-center" data-testid="git-commit-graph-loading">
            <RefreshCwIcon className="size-4 animate-spin text-muted-foreground/30" aria-hidden />
          </div>
        )
        : layoutCommits.length === 0
          ? (
            <div className="flex flex-1 items-center justify-center p-4" data-testid="git-commit-graph-empty">
              <p className="text-xs text-muted-foreground">暂无 commit</p>
            </div>
          )
          : (
            <div className="flex min-h-0 flex-1 flex-col">
              <TooltipProvider delayDuration={700}>
                <div
                  className="flex-1"
                  data-testid="git-commit-graph"
                  data-commit-count={String(layoutCommits.length)}
                >
                  <VList
                    ref={vListRef}
                    className="flex-1 [&::-webkit-scrollbar]:hidden"
                    itemSize={ROW_HEIGHT}
                    onScroll={handleRangeChange}
                  >
                    {layoutCommits.map(commit => (
                      <GitGraphRow key={commit.sha} commit={commit} />
                    ))}
                  </VList>
                </div>
              </TooltipProvider>
              {graphFetching && !graphLoading && (
                <div className="flex shrink-0 items-center justify-center py-1.5">
                  <RefreshCwIcon className="size-3.5 animate-spin text-muted-foreground/30" aria-hidden />
                </div>
              )}
            </div>
          )}
    </div>
  )
}
