// Input: useWorkspaceFile, MarkdownEditor, lazy panels, workspace data, git status, sessions
// Output: WorkspaceDetailPage — Linear-style scrollable tab project view with directly editable editor
// Position: Feature component for the workspace-detail tab

import { Link } from '@cradle/tabs-next'
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
import type { CSSProperties } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getSessions, getWorkflowRulesByWorkspaceId, getWorkspacesById, getWorkspacesByIdGitStatus, patchWorkspacesById, postSessions } from '~/api-gen/sdk.gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Button } from '~/components/ui/button'
import { startChatResponse } from '~/features/chat/chat-response-command'
import type { WorkspaceSession } from '~/features/workspace/use-session'
import { sessionsQueryKey } from '~/features/workspace/use-session'
import { WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import type { Workspace } from '~/lib/types'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

import { CapsuleComposer } from './capsule-composer'
import { useWorkspaceFile } from './use-workspace-file'

const LazySkillManager = lazy(() => import('~/features/skills/skill-manager').then(module => ({ default: module.SkillManager })))
const LazyWorkspaceWorkflowRules = lazy(() => import('./workspace-workflow-rules').then(module => ({ default: module.WorkspaceWorkflowRules })))

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

interface TocHeadingLayout extends TocHeading {
  top: number
  height: number
  visible: boolean
  intensity: number
}

interface TocLayout {
  height: number
  activeSlug: string | null
  items: TocHeadingLayout[]
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
const ACTIVE_HEADING_TOP_OFFSET = 80
const HEADING_SELECTOR = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
const TOC_ITEM_HEIGHT = 22
const EMPTY_TOC_LAYOUT: TocLayout = { height: 0, activeSlug: null, items: [] }
const TOC_PROXIMITY_FADE_RATIO = 0.72

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

function collectVisibleHeadings(container: HTMLElement): HTMLElement[] {
  return Array
    .from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .filter(el => el.offsetParent !== null)
}

function buildTocLayout(container: HTMLElement, headings: TocHeading[]): TocLayout {
  const headingEls = collectVisibleHeadings(container)
  if (headingEls.length === 0 || headings.length === 0) {
    return EMPTY_TOC_LAYOUT
  }

  const visibleCount = Math.min(headingEls.length, headings.length)
  const trackHeight = visibleCount * TOC_ITEM_HEIGHT
  const containerTop = container.getBoundingClientRect().top
  const activeScrollTop = container.scrollTop + ACTIVE_HEADING_TOP_OFFSET
  const fadeDistance = Math.max(container.clientHeight * TOC_PROXIMITY_FADE_RATIO, 1)
  let activeSlug = headingEls[0]?.id ?? null

  const items = headingEls.slice(0, visibleCount).map((el, index) => {
    const heading = headings[index]!
    const headingTop = el.getBoundingClientRect().top - containerTop + container.scrollTop
    const headingBottom = headingTop + el.offsetHeight
    const visible = headingBottom >= container.scrollTop && headingTop <= container.scrollTop + container.clientHeight
    const intensity = 1 - Math.min(1, Math.abs(headingTop - activeScrollTop) / fadeDistance)
    if (headingTop <= activeScrollTop) {
      activeSlug = el.id
    }

    return {
      ...heading,
      top: index * TOC_ITEM_HEIGHT,
      height: TOC_ITEM_HEIGHT,
      visible,
      intensity,
    }
  })

  return {
    height: trackHeight,
    activeSlug,
    items,
  }
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
  const saveDraft = useCallback((nextDraft: string) => {
    void file.save(nextDraft)
  }, [file])

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
      <div className="mb-3 flex items-center gap-2">
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
        onSave={saveDraft}
        placeholder={placeholder}
      />
    </section>
  )
}

/* ─── Floating TOC with folding path line ────────────────── */

function FloatingToc({
  headings,
  activeSlug,
  layout,
  onNavigate,
}: {
  headings: TocHeading[]
  activeSlug: string | null
  layout: TocLayout
  onNavigate: (slug: string) => void
}) {
  if (headings.length === 0) {
    return null
  }

  const layoutItems = layout.items.length > 0
    ? layout.items
    : headings.map((heading, index) => ({
      ...heading,
      top: index * TOC_ITEM_HEIGHT,
      height: TOC_ITEM_HEIGHT,
      visible: false,
      intensity: 0,
    }))
  const trackHeight = layout.height > 0
    ? layout.height
    : layoutItems.length * TOC_ITEM_HEIGHT

  const minLevel = Math.min(...headings.map(h => h.level))
  const xPerLevel = 10
  const trunkBase = 7
  const tocLabel = layoutItems[0]?.file ?? headings[0]?.file ?? 'Outline'
  const currentActiveSlug = layout.activeSlug ?? activeSlug
  const points: string[] = []
  for (let i = 0; i < layoutItems.length; i++) {
    const x = trunkBase + (layoutItems[i]!.level - minLevel) * xPerLevel
    const y = layoutItems[i]!.top + layoutItems[i]!.height / 2

    if (i === 0) {
      points.push(`M ${x} ${y}`)
    }
    else {
      const prevX = trunkBase + (layoutItems[i - 1]!.level - minLevel) * xPerLevel
      points.push(`L ${prevX} ${y}`)
      if (prevX !== x) {
        points.push(`L ${x} ${y}`)
      }
    }
  }
  const pathD = points.join(' ')

  return (
    <nav className="sticky top-6 w-58 shrink-0 pt-6 pr-4 select-none">
      <span className="block text-[10px] font-mono text-muted-foreground font-medium mb-1.5 px-2">
        {tocLabel}
      </span>
      <div className="relative" style={{ height: trackHeight }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height={trackHeight}
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

        {layoutItems.map((h) => {
          const indent = (h.level - minLevel) * xPerLevel
          const x = trunkBase + indent
          const isActive = currentActiveSlug === h.slug
          const isVisible = h.visible && !isActive
          const proximityOpacity = 0.42 + h.intensity * 0.42
          const tocItemStyle = {
            'top': h.top,
            'height': h.height,
            'paddingLeft': x + 10,
            '--toc-item-opacity': isActive ? 1 : proximityOpacity,
            '--toc-dot-opacity': isActive ? 1 : Math.max(proximityOpacity, isVisible ? 0.78 : 0.5),
          } as CSSProperties

          return (
            <button
              key={`${h.file}-${h.slug}`}
              type="button"
              onClick={() => onNavigate(h.slug)}
              className={cn(
                'group/toc-item absolute flex items-center w-full text-left transition-[color,opacity,text-shadow]',
                'opacity-[var(--toc-item-opacity)] hover:opacity-100 focus-visible:opacity-100',
                'focus-visible:outline-none',
                isActive
                  ? 'text-foreground'
                  : isVisible
                    ? 'text-foreground/70 hover:text-foreground focus-visible:text-foreground'
                  : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
              )}
              style={tocItemStyle}
            >
              <span
                className={cn(
                  'absolute size-1.5 rounded-full border transition-[background-color,border-color,box-shadow,opacity]',
                  'opacity-[var(--toc-dot-opacity)] group-hover/toc-item:opacity-100 group-focus-visible/toc-item:opacity-100',
                  isActive
                    ? 'bg-foreground border-foreground shadow-[0_0_10px_color-mix(in_oklab,currentColor_60%,transparent)]'
                    : isVisible
                      ? 'bg-foreground/35 border-foreground/35 group-hover/toc-item:bg-foreground/75 group-hover/toc-item:border-foreground/75 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:bg-foreground/75 group-focus-visible/toc-item:border-foreground/75 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)]'
                    : 'bg-background border-muted-foreground/30 group-hover/toc-item:bg-foreground/70 group-hover/toc-item:border-foreground/70 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)] group-focus-visible/toc-item:bg-foreground/70 group-focus-visible/toc-item:border-foreground/70 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)]',
                )}
                style={{
                  left: x - 3,
                }}
              />
              <span className="truncate text-[11px] transition-[text-shadow] group-hover/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)]">{h.text}</span>
            </button>
          )
        })}
      </div>
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
  const [tocLayout, setTocLayout] = useState<TocLayout>(EMPTY_TOC_LAYOUT)

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
      return (data ?? []) as WorkspaceSession[]
    },
    enabled: !!workspaceId,
  })

  const agents = useWorkspaceFile(workspaceId, 'AGENTS.md')
  const { data: workflowRule } = useQuery({
    queryKey: ['workflow-rules', workspaceId, selectedWorkflowAgentId],
    queryFn: async () => {
      const { data } = await getWorkflowRulesByWorkspaceId({
        path: { workspaceId },
        query: selectedWorkflowAgentId ? { agentProfileId: selectedWorkflowAgentId } : {},
      })
      return data as { global: string | null, profileSpecific: string | null }
    },
    enabled: activeTab === 'workflow-rules' && !!workspaceId,
  })
  const workflowContent = selectedWorkflowAgentId
    ? (workflowRule?.profileSpecific ?? null)
    : (workflowRule?.global ?? null)

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
    opts: { runtimeKind: 'standard' | 'claude-agent' | 'codex' | 'jar-core' | 'acp-chat' | 'cli-tui', agentId?: string, agentProfileId?: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' },
  ) => {
    if (!workspace) {
      return
    }
    if (opts.runtimeKind === 'cli-tui') {
      if (!opts.agentId) {
        return
      }
      const { data: sessionData } = await postSessions({
        body: { workspaceId, agentId: opts.agentId, title: text.slice(0, 80) || 'CLI TUI Session' },
      })
      const session = sessionData as { id: string } | null
      if (!session?.id) {
        return
      }
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
      openTab('chat', { sessionId: session.id })
      return
    }
    const { data: sessionData } = await postSessions({
      body: { workspaceId, agentProfileId: opts.agentProfileId!, runtimeKind: opts.runtimeKind, title: text.slice(0, 80) || opts.agentProfileId || 'New Chat' },
    })
    const session = sessionData as { id: string } | null
    if (!session?.id) {
      return
    }
    await startChatResponse({
      sessionId: session.id,
      body: { text, modelId: opts.modelId, thinkingEffort: opts.thinkingEffort },
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

    let animationFrameId: number | null = null

    const updateTocState = () => {
      const nextLayout = buildTocLayout(container, headings)
      setActiveSlug(nextLayout.activeSlug)
      setTocLayout(nextLayout)
    }

    const queueTocStateUpdate = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null
        updateTocState()
      })
    }

    const handleScroll = () => {
      queueTocStateUpdate()
    }

    const mutationObserver = new MutationObserver(queueTocStateUpdate)
    const resizeObserver = new ResizeObserver(queueTocStateUpdate)

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
    })
    resizeObserver.observe(container)
    if (container.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(container.firstElementChild)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    queueTocStateUpdate()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [activeTab, headings])

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
    tocLayout,
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

          {activeTab === 'workflow-rules' && (
            <Suspense fallback={<WorkspacePaneLoading label="Loading workflow…" testId="workspace-workflow-loading" />}
            >
              <LazyWorkspaceWorkflowRules
                workspaceId={workspaceId}
                selectedAgentId={selectedWorkflowAgentId}
                onSelectedAgentId={setSelectedWorkflowAgentId}
              />
            </Suspense>
          )}

          {activeTab === 'skills' && (
            <Suspense fallback={<WorkspacePaneLoading label="Loading skills…" testId="workspace-skills-loading" />}
            >
              <LazySkillManager
                workspaceId={workspaceId}
                editableScope="workspace"
                pageTestId="workspace-skills-page"
                title="Workspace Skills"
                description="Manage repository-standard skills under .agents/skills while reviewing inherited Cradle-only and built-in skills."
              />
            </Suspense>
          )}

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

function WorkspacePaneLoading({ label, testId }: { label: string, testId: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
    >
      <span className="inline-flex items-center gap-2 rounded-md bg-foreground/4 px-3 py-2">
        <Loader2Icon className="size-3.5 animate-spin" />
        <span>{label}</span>
      </span>
    </div>
  )
}

function WorkspaceDetailSidebar({ owner }: { owner: ReturnType<typeof useWorkspaceDetailOwner> }) {
  const { gitStatus, handleNewChat, handleOpenInApp, handleOpenInFinder, now, openTab: _openTab, recentSessions, sessions, workspace } = owner

  if (!workspace) {
    return null
  }

  return (
    <div className="w-62 shrink-0 overflow-y-auto border-l border-border">
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
                <Link
                  key={session.id}
                  to="chat"
                  params={{ sessionId: session.id }}
                  className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent/50"
                >
                  <MessageSquareIcon className="size-2.5 shrink-0 text-muted-foreground/35" />
                  <span className="flex-1 truncate text-foreground">{session.title || 'Untitled'}</span>
                  <time className="shrink-0 tabular-nums text-[10px] text-muted-foreground" suppressHydrationWarning>
                    {timeAgo(session.updatedAt, now)}
                  </time>
                </Link>
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
            layout={owner.tocLayout}
            onNavigate={owner.handleTocNavigate}
          />
        )}
      </div>

      <WorkspaceDetailSidebar owner={owner} />
    </div>
  )
}
