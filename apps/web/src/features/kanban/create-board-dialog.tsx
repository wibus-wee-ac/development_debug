// Input: open state, onClose callback, optional defaultWorkspaceId
// Output: Floating modal for creating a new kanban board
// Position: Dialog component triggered from KanbanSidebar

import { ChevronDownIcon, XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { useCreateBoard } from './use-kanban'

interface CreateBoardDialogProps {
  open: boolean
  onClose: () => void
  defaultWorkspaceId?: string
  onCreated?: (board: { id: string }) => void
}

export function CreateBoardDialog({ open, onClose, defaultWorkspaceId, onCreated }: CreateBoardDialogProps) {
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? '')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const { workspaces } = useWorkspaces()
  const createBoard = useCreateBoard()

  const selectedWorkspace = workspaces.find(w => w.id === workspaceId)

  useEffect(() => {
    if (!open) return
    setName('')
    if (defaultWorkspaceId) {
      setWorkspaceId(defaultWorkspaceId)
    } else if (workspaces.length === 1) {
      setWorkspaceId(workspaces[0].id)
    }
    const timer = setTimeout(() => nameInputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [open, defaultWorkspaceId, workspaces])

  const handleSubmit = () => {
    if (!name.trim() || !workspaceId) return
    createBoard.mutate({ workspaceId, name: name.trim() }, {
      onSuccess: (board) => {
        setName('')
        onCreated?.(board)
        onClose()
      },
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
          {/* Scrim */}
          <m.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute inset-0 bg-black/20"
            onClick={onClose}
          />

          {/* Panel */}
          <m.div
            key="panel"
            initial={{ opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            onKeyDown={handleKeyDown}
            className="relative w-full max-w-md rounded-2xl border border-border bg-card shadow-[0_8px_40px_-8px_rgba(0,0,0,0.15),0_2px_8px_-2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]"
          >
            {/* ── Header ── */}
            <div className="flex items-center px-4 pt-3 pb-0">
              <span className="text-[12px] font-medium text-muted-foreground">New Board</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <XIcon className="size-3" />
              </button>
            </div>

            {/* ── Body ── */}
            <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
              {/* Workspace selector */}
              {workspaces.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground/70">Workspace</label>
                  <Menu>
                    <MenuTrigger
                      className={cn(
                        'flex items-center justify-between rounded-lg border border-border px-3 py-1.5',
                        'text-[13px] text-foreground bg-transparent',
                        'hover:bg-muted/50 transition-colors',
                      )}
                    >
                      <span className={cn(!selectedWorkspace && 'text-muted-foreground/50')}>
                        {selectedWorkspace?.name ?? 'Select workspace'}
                      </span>
                      <ChevronDownIcon className="size-3 text-muted-foreground" />
                    </MenuTrigger>
                    <MenuPopup>
                      {workspaces.map(ws => (
                        <MenuItem
                          key={ws.id}
                          onClick={() => setWorkspaceId(ws.id)}
                        >
                          {ws.name}
                        </MenuItem>
                      ))}
                    </MenuPopup>
                  </Menu>
                </div>
              )}

              {/* Board name input */}
              <div className="flex flex-col gap-1.5">
                {workspaces.length > 1 && (
                  <label className="text-[11px] font-medium text-muted-foreground/70">Name</label>
                )}
                <input
                  ref={nameInputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Board name"
                  className="w-full rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/50 transition-colors"
                />
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-end gap-2 px-4 pb-3">
              <button
                onClick={handleSubmit}
                disabled={!name.trim() || !workspaceId || createBoard.isPending}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium',
                  'bg-primary text-primary-foreground',
                  'hover:bg-primary/90 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'shadow-[0_1px_3px_rgba(0,0,0,0.15),0_1px_2px_-1px_rgba(0,0,0,0.1)]',
                )}
              >
                Create board
                <kbd className="ml-0.5 rounded border border-border bg-muted px-1 text-[10px] text-muted-foreground font-sans leading-4">⌘↵</kbd>
              </button>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  )
}
