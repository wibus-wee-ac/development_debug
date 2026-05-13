// Input: FileTree, GitPanel, IssueAsidePanel, GitBranchControl, workspaceId prop, sessionId prop, motion/react
// Output: RightAside component — tabbed right aside panel with File Tree, Git, and Issue tabs
// Position: Slot content for AppLayout aside prop; shown when asideOpen=true

import { useQuery } from '@tanstack/react-query'
import { CircleDotIcon, FolderTreeIcon, GitBranchIcon, TimerIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useState } from 'react'

import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { GitPanel } from '~/features/git'
import { IssueAsidePanel } from '~/features/kanban/issue-aside-panel'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { AwaitPanel } from '~/features/session-await/await-panel'
import { FileTree } from '~/features/workspace/file-tree'
import { cn } from '~/lib/cn'

interface Tab {
  id: string
  label: string
  icon: typeof FolderTreeIcon
}

const TABS: Tab[] = [
  { id: 'files', label: '文件', icon: FolderTreeIcon },
  { id: 'git', label: 'Git', icon: GitBranchIcon },
  { id: 'issue', label: 'Issue', icon: CircleDotIcon },
  { id: 'await', label: 'Feed', icon: TimerIcon },
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
  const [packOpen, setPackOpen] = useState(false)
  const [packInitialPaths, setPackInitialPaths] = useState<string[]>([])

  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId! } })
      return data as import('~/lib/types').Workspace | undefined
    },
    enabled: !!workspaceId,
  })

  const handlePackRequested = useCallback((paths: string[]) => {
    setPackInitialPaths(paths)
    setPackOpen(true)
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside" data-active-tab={activeTab}>
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border/30 px-2 py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            data-testid={`right-aside-tab-${id}`}
            data-active={activeTab === id ? 'true' : 'false'}
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
        {activeTab === 'files' && (
          <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-files">
            <FileTree
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              onPackRequested={workspaceId ? handlePackRequested : undefined}
            />
          </div>
        )}
        {activeTab === 'git' && (
          <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-git">
            <GitPanel workspaceId={workspaceId} />
          </div>
        )}
        {activeTab === 'issue' && sessionId && (
          <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-issue">
            <IssueAsidePanel sessionId={sessionId} workspaceId={workspaceId} />
          </div>
        )}
        {activeTab === 'issue' && !sessionId && (
          <div className="flex flex-1 items-center justify-center" data-testid="right-aside-panel-issue-empty">
            <p className="text-[11px] text-muted-foreground">未选择会话</p>
          </div>
        )}
        {activeTab === 'await' && (
          <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-await">
            <AwaitPanel sessionId={sessionId ?? null} />
          </div>
        )}
      </div>

      {workspaceId && workspace && (
        <PackCodebaseDialog
          workspaceId={workspaceId}
          workspaceName={workspace.name ?? workspaceId}
          initialPaths={packInitialPaths}
          open={packOpen}
          onOpenChange={setPackOpen}
        />
      )}
    </div>
  )
}
