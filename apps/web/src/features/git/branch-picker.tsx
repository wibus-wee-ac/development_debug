// Input: useGitBranches, git SDK, useQueryClient, coss Popover primitives, lucide icons
// Output: BranchPicker — popover listing local + remote branches with inline branch creation (VS Code style)
// Position: Used by GitBranchControl as the branch-switching overlay

import { useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  GitBranchIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'

import { postWorkspacesByIdGitBranches, postWorkspacesByIdGitCheckout, postWorkspacesByIdGitFetch } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import {
  gitBranchesQueryKey,
  gitGraphQueryKey,
  gitStatusQueryKey,
  useGitBranches,
} from './use-git'

interface BranchPickerProps {
  workspaceId: string
  currentBranch: string
  createDialogRef?: React.RefObject<unknown>
  children: React.ReactNode
}

export function BranchPicker({
  workspaceId,
  currentBranch,
  createDialogRef: _createDialogRef,
  children,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [fetching, setFetching] = useState(false)
  // inline create-branch state
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)
  const createInputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()
  const { data: branches } = useGitBranches(workspaceId)

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey({ path: { id: workspaceId } }) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey({ path: { id: workspaceId } }) })
    // Omit query.limit to fuzzy-match all limit variants for this workspace
    void queryClient.invalidateQueries({ queryKey: gitGraphQueryKey({ path: { id: workspaceId } }) })
  }, [queryClient, workspaceId])

  const handleCheckout = useCallback(async (branch: string) => {
    setOpen(false)
    try {
      await postWorkspacesByIdGitCheckout({
        path: { id: workspaceId },
        body: { branch } as unknown as never,
      })
      invalidateAll()
    }
    catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // Strip stack trace lines; keep only the git error text
      const clean = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('at ')).join('\n').trim()
      toastManager.add({ type: 'error', title: '切换分支失败', description: clean })
    }
  }, [workspaceId, invalidateAll])

  const handleFetch = useCallback(async () => {
    setFetching(true)
    try {
      await postWorkspacesByIdGitFetch({ path: { id: workspaceId } })
      invalidateAll()
    }
    finally {
      setFetching(false)
    }
  }, [workspaceId, invalidateAll])

  const startCreating = useCallback(() => {
    setCreating(true)
    setNewName('')
    setCreateError(null)
    // defer focus so input is mounted
    requestAnimationFrame(() => createInputRef.current?.focus())
  }, [])

  const cancelCreating = useCallback(() => {
    setCreating(false)
    setNewName('')
    setCreateError(null)
  }, [])

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name) {
      return
    }
    setCreateLoading(true)
    setCreateError(null)
    try {
      await postWorkspacesByIdGitBranches({
        path: { id: workspaceId },
        body: { name } as unknown as never,
      })
      invalidateAll()
      setOpen(false)
      setCreating(false)
    }
    catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const clean = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('at ')).join('\n').trim()
      setCreateError(clean || '创建失败')
    }
    finally {
      setCreateLoading(false)
    }
  }, [newName, workspaceId, invalidateAll])

  const q = search.toLowerCase()
  const deferredQ = useDeferredValue(q)
  const localFiltered = useMemo(
    () => (branches?.local ?? []).filter(b => b.name.toLowerCase().includes(deferredQ)),
    [branches, deferredQ],
  )
  const remoteFiltered = useMemo(
    () => (branches?.remote ?? []).filter(b => b.name.toLowerCase().includes(deferredQ)),
    [branches, deferredQ],
  )

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          cancelCreating()
        }
      }}
    >
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-72 gap-0 p-0"
        side="bottom"
        align="start"
        sideOffset={6}
        data-testid="git-branch-picker"
      >
        {creating
          ? (
            /* ── Inline create-branch panel ── */
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
                <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
                <Input
                  ref={createInputRef}
                  className="h-7 flex-1 text-xs font-mono"
                  placeholder="feature/my-branch"
                  value={newName}
                  data-testid="git-branch-create-input"
                  onChange={(e) => {
                    setNewName(e.target.value)
                    setCreateError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleCreate()
                    }
                    if (e.key === 'Escape') {
                      cancelCreating()
                    }
                  }}
                  disabled={createLoading}
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={cancelCreating}
                  className="shrink-0 text-muted-foreground"
                  aria-label="取消"
                  data-testid="git-branch-create-cancel"
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>

              <div className="px-3 py-2">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  将基于
                  {' '}
                  <span className="font-mono text-foreground/70">{currentBranch}</span>
                  {' '}
                  创建并切换分支。按 Enter 确认。
                </p>
                {createError && (
                  <p className="mt-1.5 text-[10px] text-destructive">{createError}</p>
                )}
              </div>

              <div className="border-t border-border px-2 py-1.5">
                <button
                  type="button"
                  disabled={!newName.trim() || createLoading}
                  onClick={() => { void handleCreate() }}
                  data-testid="git-branch-create-submit"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    newName.trim() && !createLoading
                      ? 'text-foreground hover:bg-accent/60 cursor-pointer'
                      : 'text-muted-foreground/40 cursor-not-allowed',
                  )}
                >
                  <PlusIcon className="size-3 shrink-0" aria-hidden />
                  {createLoading
                    ? '创建中…'
                    : newName.trim()
                      ? `创建 "${newName.trim()}"`
                      : '输入分支名称'}
                </button>
              </div>
            </div>
          )
          : (
            /* ── Normal branch list panel ── */
            <div className="flex flex-col">
              {/* Header */}
              <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
                <Input
                  className="h-7 text-xs"
                  placeholder="搜索或切换分支…"
                  value={search}
                  data-testid="git-branch-search"
                  onChange={(e) => {
                    setSearch(e.target.value)
                  }}
                  autoFocus
                />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title="fetch --all --prune"
                  onClick={() => { void handleFetch() }}
                  disabled={fetching}
                  className="shrink-0"
                  data-testid="git-branch-fetch"
                >
                  <RefreshCwIcon className={cn('size-3.5', fetching && 'animate-spin')} />
                </Button>
              </div>

              {/* Branch list */}
              <div className="max-h-64 overflow-y-auto py-1">
                {localFiltered.length > 0 && (
                  <div>
                    <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      本地分支
                    </p>
                    {localFiltered.map(b => (
                      <button
                        key={b.name}
                        type="button"
                        onClick={() => { void handleCheckout(b.name) }}
                        data-testid="git-branch-option"
                        data-branch-scope="local"
                        data-branch-name={b.name}
                        data-branch-current={b.name === currentBranch ? 'true' : 'false'}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60 transition-colors"
                      >
                        <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
                        <span className="flex-1 break-all font-mono">{b.name}</span>
                        {b.name === currentBranch && (
                          <CheckIcon className="size-3 shrink-0 text-primary" aria-hidden />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {remoteFiltered.length > 0 && (
                  <div>
                    <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      远端分支
                    </p>
                    {remoteFiltered.map(b => (
                      <button
                        key={b.name}
                        type="button"
                        onClick={() => { void handleCheckout(b.name) }}
                        data-testid="git-branch-option"
                        data-branch-scope="remote"
                        data-branch-name={b.name}
                        data-branch-current="false"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/60 transition-colors"
                      >
                        <GitBranchIcon className="size-3 shrink-0 text-muted-foreground/30" aria-hidden />
                        <span className="flex-1 break-all font-mono text-muted-foreground">{b.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {localFiltered.length === 0 && remoteFiltered.length === 0 && (
                  <p className="p-3 text-center text-xs text-muted-foreground">
                    {search ? '无匹配分支' : '加载中…'}
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-border px-2 py-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                  onClick={startCreating}
                  data-testid="git-branch-start-create"
                >
                  <PlusIcon className="size-3 shrink-0" aria-hidden />
                  新建分支…
                </button>
              </div>
            </div>
          )}
      </PopoverContent>
    </Popover>
  )
}
