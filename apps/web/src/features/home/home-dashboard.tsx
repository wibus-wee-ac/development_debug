// Input: useWorkspaces, useSessions (per workspace), GlobalSearchDialog, useCradleNavigation
// Output: HomeDashboard — scenario-driven dashboard hub
// Position: Main content for the home tab; no composer, no chat entry point

import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  BotIcon,
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  PlusIcon,
  SearchIcon,
  TimerIcon,
  TriangleAlertIcon,
  ZapIcon,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import { getSessionsOptions } from '~/api-gen/@tanstack/react-query.gen'
import { postWorkspacesFromDirectory } from '~/api-gen/sdk.gen'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import { GlobalSearchDialog } from '~/features/search/global-search-dialog'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import type { Session, Workspace } from '~/lib/types'
import { Link } from '@cradle/tabs-next'

// ── Mock data for backend-unsupported features ────────────────────────────────

interface PendingRun {
  id: string
  title: string
  agentType: string
  reason: string
  blockedAt: number
}

interface Artifact {
  id: string
  title: string
  type: 'doc' | 'summary' | 'diff'
  createdAt: number
}

interface QuickAction {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

interface ScheduledTask {
  id: string
  label: string
  schedule: string
}

const MOCK_PENDING: PendingRun[] = [
  {
    id: 'run-1',
    title: '修复 auth 登录 bug',
    agentType: 'Code Agent',
    reason: '需要确认是否应用 diff',
    blockedAt: Date.now() / 1000 - 720,
  },
  {
    id: 'run-2',
    title: '本周项目周报',
    agentType: 'Writer Agent',
    reason: '等待你审阅后发布',
    blockedAt: Date.now() / 1000 - 3600,
  },
]

const MOCK_ARTIFACTS: Artifact[] = [
  { id: 'art-1', title: '产品设计研究 · 2026-04-24', type: 'doc', createdAt: Date.now() / 1000 - 86400 },
  { id: 'art-2', title: 'Cradle 架构 diff — provider 重构', type: 'diff', createdAt: Date.now() / 1000 - 172800 },
  { id: 'art-3', title: '竞品调研总结', type: 'summary', createdAt: Date.now() / 1000 - 259200 },
]

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'browse', label: '网页调研', description: '让 agent 去搜集资料', icon: <GlobeIcon className="size-3.5" /> },
  { id: 'code', label: '修复代码', description: '选择文件，agent 给出 diff', icon: <CodeIcon className="size-3.5" /> },
  { id: 'summarize', label: '沉淀为文档', description: '把会话内容整理成文档', icon: <FileTextIcon className="size-3.5" /> },
  { id: 'automate', label: '新建自动化', description: '设置定时 / 触发任务', icon: <ZapIcon className="size-3.5" /> },
]

const MOCK_SCHEDULED: ScheduledTask[] = [
  { id: 'sch-1', label: '项目周报生成', schedule: '每周一 09:00' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - unixTimestamp
  if (diff < 60) {
    return '刚刚'
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)}d`
  }
  return `${Math.floor(diff / 2592000)}mo`
}

function SectionLabel({ label, count }: { label: string, count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {count !== undefined && (
        <span className="rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

// ── Activity card ─────────────────────────────────────────────────────────────

type ActivityCardKind = 'workspace' | 'session' | 'doc' | 'diff' | 'summary'

const CARD_THEMES: Record<ActivityCardKind, { bg: string, icon: React.ReactNode }> = {
  workspace: {
    bg: 'bg-blue-500/10',
    icon: <FolderIcon className="size-5 text-blue-500/60" />,
  },
  session: {
    bg: 'bg-violet-500/10',
    icon: <ClockIcon className="size-5 text-violet-500/60" />,
  },
  doc: {
    bg: 'bg-emerald-500/10',
    icon: <FileTextIcon className="size-5 text-emerald-500/60" />,
  },
  diff: {
    bg: 'bg-orange-500/10',
    icon: <CodeIcon className="size-5 text-orange-500/60" />,
  },
  summary: {
    bg: 'bg-pink-500/10',
    icon: <BotIcon className="size-5 text-pink-500/60" />,
  },
}

interface ActivityCardProps {
  kind: ActivityCardKind
  title: string
  meta: string
  onClick?: () => void
  to?: string
  params?: Record<string, string>
}

function ActivityCard({ kind, title, meta, onClick, to, params }: ActivityCardProps) {
  const theme = CARD_THEMES[kind]
  const className = "flex flex-col w-32 shrink-0 rounded-lg border border-border/50 overflow-hidden text-left transition-colors hover:border-border not-disabled:inset-shadow-[0_1px_--theme(--color-white/10%)]"

  const content = (
    <>
      <div className={`relative flex h-14 w-full items-center justify-center ${theme.bg}`}>
        {theme.icon}
      </div>
      <div className="flex flex-col gap-0.5 px-2.5 py-2 bg-background">
        <span className="text-xs font-medium text-foreground line-clamp-1 leading-snug">{title}</span>
        <span className="text-[10px] text-muted-foreground leading-tight">{meta}</span>
      </div>
    </>
  )

  if (to) {
    return (
      <Link to={to} params={params} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
    >
      {content}
    </button>
  )
}

// ── Pending run row ───────────────────────────────────────────────────────────

function PendingRunRow({ run }: { run: PendingRun }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md p-2 hover:bg-accent/50 transition-colors cursor-pointer">
      <TriangleAlertIcon className="size-3.5 mt-0.5 shrink-0 text-amber-500" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-xs font-medium text-foreground truncate">{run.title}</span>
        <span className="text-[11px] text-muted-foreground">
          {run.agentType}
          {' · '}
          {run.reason}
        </span>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums mt-0.5">
        {formatRelativeTime(run.blockedAt)}
        前
      </span>
    </div>
  )
}

// ── Recent session row ────────────────────────────────────────────────────────

function RecentSessionRow({ session, workspaceName }: { session: Session, workspaceName: string }) {
  return (
    <Link
      to="chat"
      params={{ sessionId: session.id }}
      className="group flex items-center gap-3 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50 w-full text-left"
      data-testid="home-recent-session"
    >
      <ClockIcon className="size-3 shrink-0 text-muted-foreground/40" />
      <span className="truncate flex-1 text-foreground">
        {session.title}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{workspaceName}</span>
      <span className="shrink-0 w-7 text-right text-[11px] text-muted-foreground tabular-nums">
        {formatRelativeTime(session.updatedAt)}
      </span>
    </Link>
  )
}

// ── Artifact row ──────────────────────────────────────────────────────────────

const ARTIFACT_ICONS: Record<Artifact['type'], React.ReactNode> = {
  doc: <FileTextIcon className="size-3.5" />,
  summary: <BotIcon className="size-3.5" />,
  diff: <CodeIcon className="size-3.5" />,
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <div className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50 cursor-pointer">
      <span className="shrink-0 text-muted-foreground">
        {ARTIFACT_ICONS[artifact.type]}
      </span>
      <span className="truncate flex-1 text-foreground">
        {artifact.title}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {formatRelativeTime(artifact.createdAt)}
      </span>
    </div>
  )
}

// ── Quick action button ───────────────────────────────────────────────────────

function QuickActionButton({ action }: { action: QuickAction }) {
  return (
    <button
      type="button"
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 w-full"
    >
      <span className="shrink-0 text-muted-foreground">
        {action.icon}
      </span>
      <span className="flex flex-col gap-0">
        <span className="font-medium text-foreground leading-tight">
          {action.label}
        </span>
        <span className="text-[10px] text-muted-foreground leading-tight">{action.description}</span>
      </span>
    </button>
  )
}

// ── Scheduled row ─────────────────────────────────────────────────────────────

function ScheduledRow({ task }: { task: ScheduledTask }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent/50 cursor-pointer">
      <TimerIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
      <span className="truncate flex-1 text-foreground">{task.label}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{task.schedule}</span>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

type ActivityItem
  = { kind: 'workspace', ws: Workspace }
    | { kind: 'session', session: Session, workspaceName: string }
    | { kind: Artifact['type'], artifact: Artifact }

export function HomeDashboard() {
  const { workspaces } = useWorkspaces()
  const [searchOpen, setSearchOpen] = useState(false)
  const queryClient = useQueryClient()
  const { selectDirectory } = useDirectoryPicker()

  const sessionQueries = useQueries({
    queries: workspaces.map(ws => getSessionsOptions({ query: { workspaceId: ws.id } })),
  })

  const recentSessions = sessionQueries
    .flatMap((q, i) => ((q.data as Session[] | undefined) ?? []).map(s => ({
      session: s,
      workspaceName: workspaces[i]?.name ?? '',
    })))
    .sort((a, b) => b.session.updatedAt - a.session.updatedAt)
    .slice(0, 10)

  // Build activity cards: recent sessions + workspaces + mock artifacts, sorted by recency
  const activityCards: ActivityItem[] = [
    ...workspaces.map(ws => ({ kind: 'workspace' as const, ws })),
    ...recentSessions.slice(0, 5).map(({ session, workspaceName }) => ({
      kind: 'session' as const,
      session,
      workspaceName,
    })),
    ...MOCK_ARTIFACTS.map(artifact => ({
      kind: artifact.type,
      artifact,
    })),
  ]

  const handleAddWorkspace = useCallback(async () => {
    const dirPath = await selectDirectory({ title: '添加项目', description: '选择一个项目目录导入到 Cradle' })
    if (!dirPath) {
      return
    }
    await postWorkspacesFromDirectory({ body: { path: dirPath } })
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }, [queryClient, selectDirectory])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background" data-testid="home-dashboard">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-md border border-border/50 bg-background px-3 h-8 text-xs text-muted-foreground transition-colors hover:border-border/80"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">搜索会话、产物、项目...</span>
          <span className="font-mono text-[10px] text-muted-foreground/35">⌘K</span>
        </button>
      </div>

      {/* Needs attention — only if pending */}
      {MOCK_PENDING.length > 0 && (
        <div className="px-4 pb-3 shrink-0">
          <SectionLabel label="需要确认" count={MOCK_PENDING.length} />
          <div className="flex flex-col gap-0.5">
            {MOCK_PENDING.map(run => (
              <PendingRunRow key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}

      {/* Activity cards — horizontal scroll */}
      <div className="px-4 pb-3 shrink-0">
        <SectionLabel label="最近活动" />
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {activityCards.map((item) => {
            if (item.kind === 'workspace') {
              return (
                <ActivityCard
                  key={`ws-${item.ws.id}`}
                  kind="workspace"
                  title={item.ws.name}
                  meta="项目"
                  to="workspace-detail"
                  params={{ workspaceId: item.ws.id }}
                />
              )
            }
            if (item.kind === 'session') {
              return (
                <ActivityCard
                  key={`sess-${item.session.id}`}
                  kind="session"
                  title={item.session.title}
                  meta={item.workspaceName}
                  to="chat"
                  params={{ sessionId: item.session.id }}
                />
              )
            }
            return (
              <ActivityCard
                key={`art-${item.artifact.id}`}
                kind={item.kind}
                title={item.artifact.title}
                meta={item.kind === 'doc' ? '文档' : item.kind === 'diff' ? 'Diff' : '摘要'}
              />
            )
          })}
          <button
            type="button"
            onClick={handleAddWorkspace}
            className="flex flex-col w-32 shrink-0 rounded-lg border border-dashed border-border/40 items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:border-border/70 h-24"
            data-testid="home-add-project-btn"
          >
            <PlusIcon className="size-3.5" />
            添加项目
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="flex flex-1 overflow-hidden divide-x divide-border/30 min-h-0">
        {/* Left column */}
        <div className="flex flex-col flex-1 overflow-y-auto min-w-0 px-4 py-2 gap-4">
          <section>
            <SectionLabel label="继续" count={recentSessions.length} />
            {recentSessions.length === 0
              ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">暂无最近会话</p>
              )
              : (
                <div className="flex flex-col gap-0.5">
                  {recentSessions.map(({ session, workspaceName }) => (
                    <RecentSessionRow
                      key={session.id}
                      session={session}
                      workspaceName={workspaceName}
                    />
                  ))}
                </div>
              )}
          </section>

          <section>
            <SectionLabel label="产物" count={MOCK_ARTIFACTS.length} />
            <div className="flex flex-col gap-0.5">
              {MOCK_ARTIFACTS.map(a => (
                <ArtifactRow key={a.id} artifact={a} />
              ))}
            </div>
          </section>
        </div>

        {/* Right column — wider */}
        <div className="flex flex-col w-80 shrink-0 overflow-y-auto px-3 py-2 gap-4">
          <section>
            <SectionLabel label="快速派发" />
            <div className="flex flex-col gap-0.5">
              {QUICK_ACTIONS.map(a => (
                <QuickActionButton key={a.id} action={a} />
              ))}
            </div>
          </section>

          <section>
            <SectionLabel label="自动化" />
            <div className="flex flex-col gap-0.5">
              {MOCK_SCHEDULED.map(t => (
                <ScheduledRow key={t.id} task={t} />
              ))}
              <button
                type="button"
                className="mt-0.5 flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border/60"
              >
                + 新建自动化
              </button>
            </div>
          </section>
        </div>
      </div>

      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
