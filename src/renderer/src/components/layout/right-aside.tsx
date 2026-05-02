// Input: FileTree, GitPanel, IssueAsidePanel, workspaceId prop, sessionId prop, motion/react
// Output: RightAside component — tabbed right aside panel with File Tree, Git, and Issue tabs
// Position: Slot content for AppLayout aside prop; shown when asideOpen=true

import { IssueAsidePanel } from '@renderer/features/kanban/issue-aside-panel'
import { GitPanel } from '@renderer/features/git'
import { FileTree } from '@renderer/features/workspace/file-tree'
import { cn } from '@renderer/lib/cn'
import { CircleDotIcon, FolderTreeIcon, GitBranchIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

interface Tab {
  id: string
  label: string
  icon: typeof FolderTreeIcon
}

const TABS: Tab[] = [
  { id: 'files', label: '文件', icon: FolderTreeIcon },
  { id: 'git', label: 'Git', icon: GitBranchIcon },
  { id: 'issue', label: 'Issue', icon: CircleDotIcon },
]

const TAB_SPRING = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
} as const

interface RightAsideProps {
  workspaceId: string | null
  workspacePath?: string | null
  sessionId?: string | null
}

export function RightAside({ workspaceId, workspacePath, sessionId }: RightAsideProps) {
  const [activeTab, setActiveTab] = useState('files')

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/30 px-2 py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors select-none z-10',
              activeTab === id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* Sliding background pill */}
            {activeTab === id && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-md bg-accent"
                transition={TAB_SPRING}
                style={{ zIndex: -1 }}
              />
            )}
            <Icon className="relative size-3.5 shrink-0" />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'files' && <FileTree workspaceId={workspaceId} workspacePath={workspacePath} />}
        {activeTab === 'git' && <GitPanel workspacePath={workspacePath} />}
        {activeTab === 'issue' && sessionId && (
          <IssueAsidePanel sessionId={sessionId} workspaceId={workspaceId} />
        )}
        {activeTab === 'issue' && !sessionId && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[11px] text-muted-foreground">未选择会话</p>
          </div>
        )}
      </div>
    </div>
  )
}
