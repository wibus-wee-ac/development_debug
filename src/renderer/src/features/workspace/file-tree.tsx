// Input: workspaceId, useWorkspaceTree hook, pathe
// Output: FileTree component — expandable draggable file tree for workspace
// Position: Content for the File Tree tab in the right aside panel

import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { cn } from '@renderer/lib/utils'
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
} from 'lucide-react'
import { normalize } from 'pathe'
import { memo, useState } from 'react'

import type { TreeNode } from './use-workspace-tree'
import { useWorkspaceTree } from './use-workspace-tree'

// ── File extension → colour accent ───────────────────────────────────────────

const EXT_COLORS: Record<string, string> = {
  ts: 'text-blue-500',
  tsx: 'text-sky-500',
  js: 'text-yellow-500',
  jsx: 'text-yellow-400',
  css: 'text-pink-400',
  scss: 'text-pink-500',
  json: 'text-amber-400',
  md: 'text-neutral-400',
  yml: 'text-emerald-400',
  yaml: 'text-emerald-400',
  toml: 'text-orange-400',
  py: 'text-green-400',
  go: 'text-cyan-400',
  rs: 'text-orange-500',
  sh: 'text-lime-400',
  env: 'text-red-400',
  svg: 'text-violet-400',
  png: 'text-violet-300',
  jpg: 'text-violet-300',
  gif: 'text-violet-300',
  sql: 'text-amber-300',
}

function fileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_COLORS[ext] ?? 'text-muted-foreground/70'
}

/** Quote path for shell insertion — wraps in double quotes if it contains spaces */
function quotePath(p: string): string {
  const normalized = normalize(p)
  return normalized.includes(' ') ? `"${normalized}"` : normalized
}

// ── Tree node ─────────────────────────────────────────────────────────────────

interface NodeProps {
  node: TreeNode
  depth: number
  workspacePath?: string
}

const TreeNodeItem = memo(function TreeNodeItem({ node, depth, workspacePath }: NodeProps) {
  const [open, setOpen] = useState(depth === 0)
  const indent = depth * 14

  function handleDragStart(e: React.DragEvent) {
    const fullPath = workspacePath ? `${workspacePath}/${node.path}` : node.path
    e.dataTransfer.setData('text/plain', quotePath(fullPath))
    e.dataTransfer.effectAllowed = 'copy'
  }

  if (node.type === 'directory') {
    return (
      <div>
        <div
          draggable
          onDragStart={handleDragStart}
          className="group flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-sidebar-foreground/80 hover:bg-accent/50 hover:text-sidebar-foreground transition-colors active:cursor-grabbing"
          style={{ paddingLeft: `${10 + indent}px` }}
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setOpen(o => !o)
            }
          }}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
          {open
            ? <FolderOpenIcon className="size-4 shrink-0 text-amber-400" />
            : <FolderIcon className="size-4 shrink-0 text-amber-400/80" />}
          <span className="truncate font-medium">{node.name}</span>
        </div>

        {open && node.children.length > 0 && (
          <div className="relative">
            {/* Indent guide line */}
            <div
              className="absolute top-0 bottom-0 w-px bg-border/40"
              style={{ left: `${10 + indent + 8}px` }}
            />
            {node.children.map(child => (
              <TreeNodeItem key={child.path} node={child} depth={depth + 1} workspacePath={workspacePath} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground transition-colors active:cursor-grabbing"
      style={{ paddingLeft: `${10 + indent + 20}px` }}
    >
      <FileIcon className={cn('size-3.5 shrink-0', fileColor(node.name))} />
      <span className="truncate">{node.name}</span>
    </div>
  )
})

// ── Main component ─────────────────────────────────────────────────────────────

interface FileTreeProps {
  workspaceId: string | null
  workspacePath?: string | null
}

export function FileTree({ workspaceId, workspacePath }: FileTreeProps) {
  const { tree, isLoading } = useWorkspaceTree(workspaceId)

  if (!workspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground/50">未关联工作区</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground/50">工作区为空</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-1 py-1.5">
      <ScrollArea>
        {tree.map(node => (
          <TreeNodeItem key={node.path} node={node} depth={0} workspacePath={workspacePath ?? undefined} />
        ))}
      </ScrollArea>
    </div>
  )
}
