// Input: FileTree, GitPanel, IssueAsidePanel, GitBranchControl, workspaceId prop, sessionId prop, motion/react
// Output: RightAside component — tabbed right aside panel with File Tree, Git, and Issue tabs
// Position: Slot content for AppLayout aside prop; shown when asideOpen=true

import { useQuery } from '@tanstack/react-query'
import { CircleDotIcon, FolderTreeIcon, GitBranchIcon, RssIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useState } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { useSessionAwaitSummary } from '~/features/chat/use-session-await'
import { GitPanel } from '~/features/git'
import { IssueAsidePanel } from '~/features/kanban/issue-aside-panel'
import { PackCodebaseDialog } from '~/features/pack-codebase/pack-codebase-dialog'
import { AwaitPanel } from '~/features/session-await/await-panel'
import { FileTree } from '~/features/workspace/file-tree'
import { cn } from '~/lib/cn'
import { useLayoutStore } from '~/store/layout'

interface Tab {
  id: string
  label: string
  icon: typeof FolderTreeIcon
}

const TABS: Tab[] = [
  { id: 'files', label: '文件', icon: FolderTreeIcon },
  { id: 'git', label: 'Git', icon: GitBranchIcon },
  { id: 'issue', label: 'Issue', icon: CircleDotIcon },
  { id: 'await', label: 'Feed', icon: RssIcon },
]

const TAB_SPRING = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
} as const

interface RightAsideProps {
  sessionId: string
}

export function RightAside({ sessionId }: RightAsideProps) {
  const activeTab = useLayoutStore(s => s.asideActiveTab)
  const setActiveTab = useLayoutStore(s => s.setAsideActiveTab)
  const [packOpen, setPackOpen] = useState(false)
  const [packInitialPaths, setPackInitialPaths] = useState<string[]>([])

  // Derive workspaceId from session
  const { data: sessionMeta } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    select: s => ({ workspaceId: s?.workspaceId as string | null }),
    staleTime: 60_000,
  })
  const workspaceId = sessionMeta?.workspaceId ?? null

  // Derive workspace details from workspaceId
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId! } })
      return data as import('~/lib/types').Workspace | undefined
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })
  const workspacePath = workspace?.path ?? null

  // Badge: pending awaits for Feed tab
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const hasPendingAwaits = awaitSummary?.awaiting ?? false

  const handlePackRequested = useCallback((paths: string[]) => {
    setPackInitialPaths(paths)
    setPackOpen(true)
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside" data-active-tab={activeTab}>
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border px-2 py-1.5">
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
              <m.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-md bg-accent"
                transition={TAB_SPRING}
                style={{ zIndex: -1 }}
              />
            )}
            <Icon className="relative size-3.5 shrink-0" />
            <span className="relative">{label}</span>
            {/* Badge dot for Feed tab when awaits are pending */}
            {id === 'await' && hasPendingAwaits && activeTab !== 'await' && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            )}
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
