// Input: useWorkspaceFile, MarkdownEditor, workspace data, git status, sessions, CSS tab switching
// Output: WorkspaceDetailPage — Linear-style scrollable tab project view with Overview and Workflow Rules
// Position: Feature component for the workspace-detail tab

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  Loader2Icon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PencilIcon,
  ScrollTextIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getSessions, getWorkspacesById, getWorkspacesByIdGitStatus, patchWorkspacesById, postSessions } from '~/api-gen/sdk.gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Button } from '~/components/ui/button'
import { SkillManager } from '~/features/skills/skill-manager'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import type { Session, Workspace } from '~/lib/types'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { CapsuleComposer } from './capsule-composer'
import { useWorkspaceFile } from './use-workspace-file'
import { useWorkspaceWorkflowRuleContent, WorkspaceWorkflowRules } from './workspace-workflow-rules'

/* ─── Types ──────────────────────────────────────────────── */

interface WorkspaceDetailPageProps {
  workspaceId: string
}

interface TocHeading {
  level: number
  text: string
  slug: string
  file: string
}

/* ─── Helpers ────────────────────────────────────────────── */

function timeAgo(ts: number, nowMs: number): string {
  const diff = Math.floor(nowMs / 1000) - ts
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

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const HEADING_RE = /^(#{1,6})\s+(\S.*)$/gm
const RE_NON_WORD = /[^\w\u4E00-\u9FFF]+/g
const RE_BOUNDARY_DASH = /(^-|-$)/g
const RE_FENCED_CODE = /```[\s\S]*?```/g

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(RE_NON_WORD, '-')
    .replace(RE_BOUNDARY_DASH, '')
}

function parseHeadings(markdown: string | null, file: string): TocHeading[] {
  if (!markdown) {
    return []
  }
  const result: TocHeading[] = []

  // Strip fenced code blocks before parsing headings
  const stripped = markdown.replace(RE_FENCED_CODE, '')

  HEADING_RE.lastIndex = 0
  let match: RegExpExecArray | null = HEADING_RE.exec(stripped)
  while (match !== null) {
    result.push({
      level: match[1]!.length,
      text: match[2]!.trim(),
      slug: slugify(match[2]!.trim()),
      file,
    })
    match = HEADING_RE.exec(stripped)
  }
  return result
}

/* ─── Inline editable title ──────────────────────────────── */

function InlineEditTitleEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const commit = useCallback(() => {
    const trimmed = inputRef.current?.value.trim() ?? ''
    if (trimmed && trimmed !== initialValue) {
      onCommit(trimmed)
    }
    onCancel()
  }, [initialValue, onCancel, onCommit])

  return (
    <input
      ref={inputRef}
      data-testid="workspace-detail-title-input"
      defaultValue={initialValue}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
        }
        if (e.key === 'Escape') {
          onCancel()
        }
      }}
      className="w-full max-w-80 border-b border-foreground/20 bg-transparent py-px text-lg font-semibold text-foreground outline-none focus:border-foreground/50"
    />
  )
}

function InlineEditTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)

  return (
    editing
      ? (
          <InlineEditTitleEditor
            key={value}
            initialValue={value}
            onCommit={onSave}
            onCancel={() => setEditing(false)}
          />
        )
      : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid="workspace-detail-title-trigger"
            className="group inline-flex items-center gap-2 text-left"
          >
            <span className="text-lg font-semibold text-foreground">{value}</span>
            <PencilIcon className="size-3 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )
  )
}

/* ─── Document section ───────────────────────────────────── */

function DocumentSection({
  id,
  filename,
  testId,
  file,
  placeholder,
}: {
  id: string
  filename: string
  testId?: string
  file: { content: string | null, loading: boolean, saving: boolean, save: (md: string) => Promise<unknown> }
  placeholder: string
}) {
  if (file.loading) {
    return (
      <div id={id} className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        正在加载...
      </div>
    )
  }

  if (file.content === null) {
    return null
  }

  return (
    <section id={id} data-testid={testId}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] font-mono text-muted-foreground">{filename}</span>
        {file.saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2Icon className="size-2.5 animate-spin" />
            保存中
          </span>
        )}
      </div>
      <MarkdownEditor
        content={file.content}
        onSave={md => void file.save(md)}
        placeholder={placeholder}
      />
    </section>
  )
}

/* ─── Floating TOC with folding path line ────────────────── */

function FloatingToc({
  headings,
  activeSlug,
  onNavigate,
}: {
  headings: TocHeading[]
  activeSlug: string | null
  onNavigate: (slug: string) => void
}) {
  if (headings.length === 0) {
    return null
  }

  // Group by file
  const grouped: { file: string, items: TocHeading[] }[] = []
  let currentGroup: { file: string, items: TocHeading[] } | null = null
  for (const h of headings) {
    if (!currentGroup || currentGroup.file !== h.file) {
      currentGroup = { file: h.file, items: [] }
      grouped.push(currentGroup)
    }
    currentGroup.items.push(h)
  }

  const minLevel = Math.min(...headings.map(h => h.level))
  const xPerLevel = 10
  const trunkBase = 7
  const itemH = 22

  return (
    <nav className="sticky top-6 w-58 shrink-0 pt-6 pr-4 select-none">
      {grouped.map((group) => {
        const totalH = group.items.length * itemH

        // Build a single continuous folding polyline path
        // The line runs vertically then bends horizontally when indent changes
        const points: string[] = []
        for (let i = 0; i < group.items.length; i++) {
          const x = trunkBase + (group.items[i]!.level - minLevel) * xPerLevel
          const y = i * itemH + itemH / 2

          if (i === 0) {
            // Start at first item
            points.push(`M ${x} ${y}`)
          }
          else {
            const prevX = trunkBase + (group.items[i - 1]!.level - minLevel) * xPerLevel
            // Vertical down at previous x, then horizontal to new x
            points.push(`L ${prevX} ${y}`)
            if (prevX !== x) {
              points.push(`L ${x} ${y}`)
            }
          }
        }
        const pathD = points.join(' ')

        return (
          <div key={group.file} className="mb-4">
            <span className="block text-[10px] font-mono text-muted-foreground font-medium mb-1.5 px-2">
              {group.file}
            </span>
            <div className="relative" style={{ height: totalH }}>
              {/* Single folding path line */}
              <svg
                className="absolute inset-0 pointer-events-none"
                width="100%"
                height={totalH}
                aria-hidden="true"
              >
                <path
                  d={pathD}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-border/50"
                />
              </svg>

              {/* Heading items */}
              {group.items.map((h, i) => {
                const indent = (h.level - minLevel) * xPerLevel
                const x = trunkBase + indent
                const isActive = activeSlug === h.slug

                return (
                  <button
                    key={`${h.file}-${h.slug}`}
                    type="button"
                    onClick={() => onNavigate(h.slug)}
                    className={cn(
                      'absolute flex items-center w-full text-left transition-colors',
                      isActive
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-muted-foreground/70',
                    )}
                    style={{
                      top: i * itemH,
                      height: itemH,
                      paddingLeft: x + 10,
                    }}
                  >
                    {/* Dot on the path */}
                    <span
                      className={cn(
                        'absolute size-1.5 rounded-full border transition-colors',
                        isActive
                          ? 'bg-foreground border-foreground'
                          : 'bg-background border-muted-foreground/30',
                      )}
                      style={{ left: x - 3 }}
                    />
                    <span className="truncate text-[11px]">{h.text}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function useWorkspaceDetailOwner(workspaceId: string) {
  const queryClient = useQueryClient()
  const { openTab } = useCradleNavigation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = useNow()
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'workflow-rules' | 'skills'>('overview')
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState<string | null>(null)

  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId,
  })

  const { data: gitStatus } = useQuery({
    queryKey: ['git-status', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByIdGitStatus({ path: { id: workspaceId } })
      return data ?? null
    },
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })

  const { data: sessions = [] } = useQuery({
    queryKey: sessionsQueryKey(workspaceId),
    queryFn: async () => {
      const { data } = await getSessions({ query: { workspaceId } })
      return (data ?? []) as Session[]
    },
    enabled: !!workspaceId,
  })

  const agents = useWorkspaceFile(workspaceId, 'AGENTS.md')
  const workflowContent = useWorkspaceWorkflowRuleContent(workspaceId, selectedWorkflowAgentId)

  const recentSessions = useMemo(() => {
    const top: typeof sessions = []
    for (const s of sessions) {
      if (top.length < 10) {
        top.push(s)
        top.sort((a, b) => b.updatedAt - a.updatedAt)
      }
      else if (s.updatedAt > top.at(-1)!.updatedAt) {
        top[top.length - 1] = s
        top.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    }
    return top
  }, [sessions])

  const headings = useMemo(() => {
    if (activeTab === 'overview') {
      return parseHeadings(agents.content, 'AGENTS.md')
    }
    if (activeTab === 'workflow-rules') {
      return parseHeadings(workflowContent, 'Workflow Rules')
    }
    return []
  }, [activeTab, agents.content, workflowContent])

  const handleRename = useCallback(async (newName: string) => {
    await patchWorkspacesById({ path: { id: workspaceId }, body: { name: newName } })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
    ])
  }, [workspaceId, queryClient])

  const handleOpenInFinder = useCallback(() => {
    // Not supported in web mode
  }, [])

  const handleOpenInApp = useCallback(async () => {
    // Not supported in web mode
  }, [])

  const handleNewChat = useCallback(() => {
    openTab('new-chat')
  }, [openTab])

  const handleCapsuleSend = useCallback(async (
    text: string,
    opts: { agentId: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' },
  ) => {
    if (!workspace) {
      return
    }
    const { data: sessionData } = await postSessions({
      body: { workspaceId, agentProfileId: opts.agentId, title: text.slice(0, 80) || opts.agentId || 'New Chat' },
    })
    const session = sessionData as { id: string } | null
    if (!session?.id) {
      return
    }
    await fetch(`${getServerUrl()}/chat/sessions/${session.id}/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, modelId: opts.modelId, thinkingEffort: opts.thinkingEffort }),
    })
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
    openTab('chat', { sessionId: session.id })
  }, [openTab, queryClient, workspace, workspaceId])

  const handleTocNavigate = useCallback((slug: string) => {
    const el = document.getElementById(slug)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSlug(slug)
    }
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    const handleScroll = () => {
      const headingEls = container.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
      if (headingEls.length === 0) {
        return
      }

      const containerRect = container.getBoundingClientRect()
      let active: string | null = null

      for (const el of headingEls) {
        // Skip elements inside hidden tab content
        if ((el as HTMLElement).offsetParent === null) {
          continue
        }
        const elTop = el.getBoundingClientRect().top - containerRect.top
        if (elTop <= 80) {
          active = el.id
        }
      }

      setActiveSlug(active)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    // Run once after content renders
    const timer = setTimeout(handleScroll, 200)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(timer)
    }
  }, [activeTab])

  return {
    activeSlug,
    activeTab,
    agents,
    gitStatus,
    handleCapsuleSend,
    handleNewChat,
    handleOpenInApp,
    handleOpenInFinder,
    handleRename,
    handleTocNavigate,
    headings,
    now,
    openTab,
    queryClient,
    recentSessions,
    scrollRef,
    selectedWorkflowAgentId,
    sessions,
    setActiveTab,
    setSelectedWorkflowAgentId,
    workspace,
    workspaceId,
  }
}

function WorkspaceDetailMainColumn({ owner }: { owner: ReturnType<typeof useWorkspaceDetailOwner> }) {
  const { activeTab, agents, handleCapsuleSend, handleRename, scrollRef, selectedWorkflowAgentId, setActiveTab, setSelectedWorkflowAgentId, workspace, workspaceId } = owner

  if (!workspace) {
    return null
  }

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <m.div className="mx-auto max-w-2xl px-2 py-6">
          <div className="mb-6">
            <InlineEditTitle value={workspace.name} onSave={handleRename} />
            <p data-testid="workspace-detail-path" className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
              {workspace.path}
            </p>
          </div>

          <div className="mb-6 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {([
              { id: 'overview', label: 'Overview', icon: FileTextIcon },
              { id: 'workflow-rules', label: 'Workflow', icon: ScrollTextIcon },
              { id: 'skills', label: 'Skills', icon: PencilIcon },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                data-testid={`workspace-detail-tab-${id}`}
                className={cn(
                  'relative z-10 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors select-none',
                  activeTab === id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {activeTab === id && (
                  <m.span
                    layoutId="workspace-detail-tab-pill"
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                <Icon className="relative size-3.5 shrink-0" />
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>

          <div className={activeTab === 'overview' ? undefined : 'hidden'}>
            <DocumentSection
              id="section-agents"
              filename="AGENTS.md"
              testId="workspace-detail-agents-section"
              file={agents}
              placeholder="配置 Agent 指令..."
            />

            {agents.content === null && !agents.loading && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                该项目中没有 AGENTS.md 文件
              </div>
            )}
          </div>

          <div className={activeTab === 'workflow-rules' ? undefined : 'hidden'}>
            <WorkspaceWorkflowRules
              workspaceId={workspaceId}
              selectedAgentId={selectedWorkflowAgentId}
              onSelectedAgentId={setSelectedWorkflowAgentId}
            />
          </div>

          <div className={activeTab === 'skills' ? undefined : 'hidden'}>
            <SkillManager
              workspaceId={workspaceId}
              editableScope="workspace"
              pageTestId="workspace-skills-page"
              title="Workspace Skills"
              description="Manage repository-specific skills under .agents/skills while reviewing inherited global and built-in skills."
            />
          </div>

          <div className="h-28" />
        </m.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
        <div className="pointer-events-auto mx-auto max-w-2xl">
          <CapsuleComposer workspaceId={workspaceId} onSend={handleCapsuleSend} />
        </div>
      </div>
    </div>
  )
}

function WorkspaceDetailSidebar({ owner }: { owner: ReturnType<typeof useWorkspaceDetailOwner> }) {
  const { gitStatus, handleNewChat, handleOpenInApp, handleOpenInFinder, now, openTab, recentSessions, sessions, workspace } = owner

  if (!workspace) {
    return null
  }

  return (
    <div className="w-62 shrink-0 overflow-y-auto border-l border-border/30">
      <div className="space-y-1 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={handleOpenInFinder}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <FolderOpenIcon className="size-3.5" />
          在 Finder 中打开
        </button>
        <button
          type="button"
          onClick={() => void handleOpenInApp()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <ExternalLinkIcon className="size-3.5" />
          在编辑器中打开
        </button>
      </div>

      <div className="mx-3 h-px bg-border/30" />

      <div className="space-y-2.5 p-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">分支</span>
          <span className="max-w-28 truncate font-mono text-[12px] text-muted-foreground">{(gitStatus as { branch?: string } | null)?.branch ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">会话</span>
          <span className="text-[12px] text-muted-foreground">{sessions.length}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">创建</span>
          <span className="text-[12px] text-muted-foreground">{formatDate(workspace.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">更新</span>
          <span className="text-[12px] text-muted-foreground">{formatDate(workspace.updatedAt)}</span>
        </div>
      </div>

      <div className="mx-3 h-px bg-border/30" />

      <div className="px-3 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="select-none text-[11px] text-muted-foreground">最近会话</span>
          <Button variant="ghost" size="icon-xs" onClick={handleNewChat} aria-label="新建聊天">
            <MessageSquarePlusIcon className="size-3" />
          </Button>
        </div>

        {recentSessions.length === 0
          ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">暂无会话</p>
          )
          : (
            <div className="flex flex-col gap-0.5 pb-3">
              {recentSessions.map(session => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => openTab('chat', { sessionId: session.id })}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/50"
                >
                  <MessageSquareIcon className="size-2.5 shrink-0 text-muted-foreground/35" />
                  <span className="flex-1 truncate text-foreground">{session.title || 'Untitled'}</span>
                  <time className="shrink-0 tabular-nums text-[10px] text-muted-foreground" suppressHydrationWarning>
                    {timeAgo(session.updatedAt, now)}
                  </time>
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

/* ─── Main ───────────────────────────────────────────────── */

export function WorkspaceDetailPage({ workspaceId }: WorkspaceDetailPageProps) {
  const owner = useWorkspaceDetailOwner(workspaceId)

  if (!owner.workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-background" data-testid="workspace-detail-page">
      <WorkspaceDetailMainColumn owner={owner} />

      <div className="w-58 shrink-0">
        {owner.headings.length > 0 && (
          <FloatingToc
            headings={owner.headings}
            activeSlug={owner.activeSlug}
            onNavigate={owner.handleTocNavigate}
          />
        )}
      </div>

      <WorkspaceDetailSidebar owner={owner} />
    </div>
  )
}
