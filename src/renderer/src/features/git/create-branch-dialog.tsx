// Input: Dialog primitives, Input, Button, ipc, useQueryClient, useGitBranches for "From" list
// Output: CreateBranchDialog — controlled Dialog for creating a new git branch, with imperative open() handle
// Position: Used by BranchPicker footer "新建分支" action; controlled via ref handle

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { ipc } from '@renderer/lib/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useImperativeHandle, useRef, useState } from 'react'

import {
  gitBranchesQueryKey,
  gitGraphQueryKey,
  gitStatusQueryKey,
  useGitBranches,
} from './use-git'

export interface CreateBranchDialogHandle {
  open: () => void
}

interface CreateBranchDialogProps {
  ref: React.Ref<CreateBranchDialogHandle>
  workspacePath: string
  currentBranch: string
}

export function CreateBranchDialog({
  ref,
  workspacePath,
  currentBranch,
}: CreateBranchDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [from, setFrom] = useState(currentBranch)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const { data: branches } = useGitBranches(workspacePath)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useImperativeHandle(ref, () => ({
    open: () => {
      setName('')
      setFrom(currentBranch)
      setError(null)
      setOpen(true)
    },
  }))

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: gitStatusQueryKey(workspacePath) })
    void queryClient.invalidateQueries({ queryKey: gitBranchesQueryKey(workspacePath) })
    void queryClient.invalidateQueries({ queryKey: gitGraphQueryKey(workspacePath, 100) })
  }, [queryClient, workspacePath])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      await ipc!.git.createBranch(workspacePath, name.trim(), from || undefined)
      invalidateAll()
      setOpen(false)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
    finally {
      setLoading(false)
    }
  }, [name, from, workspacePath, invalidateAll])

  const allBranches = [
    ...(branches?.local.map(b => b.name) ?? []),
    ...(branches?.remote.map(b => b.name) ?? []),
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger ref={triggerRef} style={{ display: 'none' }} />
      <DialogPopup showCloseButton={false} className="w-95">
        <form onSubmit={(e) => { void handleSubmit(e) }}>
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="branch-name">
                  分支名称
                </label>
                <Input
                  id="branch-name"
                  placeholder="feature/my-branch"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  disabled={loading}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="branch-from">
                  基于
                </label>
                <select
                  id="branch-from"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  disabled={loading}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {allBranches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name.trim() || loading}
            >
              {loading ? '创建中…' : '创建并切换'}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
