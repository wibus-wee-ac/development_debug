// Input: useGitGraph, useGitStatus, computeGraphLayout, GitGraphRow, BranchPicker, ipc, VList from virtua
// Output: GitPanel — full git panel with branch status bar, fetch button, and virtualized commit graph with infinite scroll
// Position: Rendered inside right-aside "Git" tab; consumes ipc.git.*

import { Button } from '@renderer/components/ui/button'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, GitBranchIcon, GitGraphIcon, RefreshCwIcon } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { VListHandle } from 'virtua'
import { VList } from 'virtua'

import { BranchPicker } from './branch-picker'
import { GitGraphRow, ROW_HEIGHT } from './git-graph-row'
import { computeGraphLayout } from './graph-layout'
import { gitBranchesQueryKey, gitStatusQueryKey, useGitGraph, useGitStatus } from './use-git'

interface GitPanelProps {
  workspacePath: string | null | undefined
}

export function GitPanel({ workspacePath }: GitPanelProps) {
  const { data: status, isLoading: statusLoading, isError: statusError } = useGitStatus(workspacePath)
  const [limit, setLimit] = useState(100)
  const { data: commits, isLoading: graphLoading, isFetching: graphFetching } = useGitGraph(workspacePath, limit)
  const [fetching, setFetching] = useState(false)
  const queryClient = useQueryClient()

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey(workspacePath) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey(workspacePath) })
    // Invalidate all graph queries for this workspace regardless of limit
    void queryClient.invalidateQueries({ queryKey: ['git-graph', workspacePath ?? null] })
  }, [queryClient, workspacePath])

  const handleFetch = useCallback(async () => {
    if (!workspacePath) {
      return
    }
    setFetching(true)
    try {
      await ipc!.git.fetch(workspacePath)
      invalidateAll()
    }
    finally {
      setFetching(false)
    }
  }, [workspacePath, invalidateAll])

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

  if (!workspacePath) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center">
        <p className="text-xs text-muted-foreground">请先选择 Workspace</p>
      </div>
    )
  }

  if (statusError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <GitGraphIcon className="size-5 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">不是 Git 仓库或无权限</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1">
        {statusLoading
          ? (
            <div className="h-5 w-24 animate-pulse rounded bg-muted/60" />
          )
          : status
            ? (
              <BranchPicker
                workspacePath={workspacePath}
                currentBranch={status.branch}
              >
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
                    'text-foreground/80 hover:text-foreground hover:bg-accent/60',
                  )}
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
          title="Fetch all (--all --prune)"
          onClick={() => { void handleFetch() }}
          disabled={fetching}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCwIcon className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {/* Commit graph */}
      {graphLoading
        ? (
          <div className="flex flex-1 items-center justify-center">
            <RefreshCwIcon className="size-4 animate-spin text-muted-foreground/30" aria-hidden />
          </div>
        )
        : layoutCommits.length === 0
          ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <p className="text-xs text-muted-foreground">暂无 commit</p>
            </div>
          )
          : (
            <div className="flex min-h-0 flex-1 flex-col">
              <TooltipProvider delayDuration={700}>
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
