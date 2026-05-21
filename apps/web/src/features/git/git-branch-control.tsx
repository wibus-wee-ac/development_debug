import { CloudIcon, GitBranchIcon } from 'lucide-react'

import { cn } from '~/lib/cn'

import { BranchPicker } from './branch-picker'
import { useGitStatus } from './use-git'

interface GitBranchControlProps {
  workspaceId: string | null | undefined
}

export function GitBranchControl({ workspaceId }: GitBranchControlProps) {
  const { data: status, isError } = useGitStatus(workspaceId)

  if (!workspaceId || isError || !status) {
    return null
  }

  return (
    <>
      <BranchPicker
        workspaceId={workspaceId}
        currentBranch={status.branch}
      >
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-accent/60',
          )}
          data-testid="git-branch-control-trigger"
          data-branch-name={status.branch}
        >
          <GitBranchIcon className="size-3 shrink-0" aria-hidden />
          <span className="max-w-28 truncate">{status.branch}</span>
          {status.ahead > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-primary font-medium">
              <CloudIcon className="size-2.5" aria-hidden />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="text-[10px] text-muted-foreground font-medium">
              ↓
              {status.behind}
            </span>
          )}
        </button>
      </BranchPicker>
    </>
  )
}
