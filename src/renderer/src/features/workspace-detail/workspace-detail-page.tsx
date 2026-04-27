// Input: useWorkspaceFile, MarkdownEditor, ipc, workspace data, git status, sessions
// Output: WorkspaceDetailPage — Linear-style scrollable project overview with TOC
// Position: Feature component for the /workspace/$workspaceId route

import { Button } from '@renderer/components/ui/button'
import { sessionsQueryKey } from '@renderer/features/workspace/use-session'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/cn'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ExternalLinkIcon,
  FolderOpenIcon,
  Loader2Icon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PencilIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MarkdownEditor } from '@renderer/components/editor/markdown-editor'
import { useWorkspaceFile } from './use-workspace-file'

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

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`
  return `${Math.floor(diff / 2592000)}mo`
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function parseHeadings(markdown: string | null, file: string): TocHeading[] {
  if (!markdown) return []
  const result: TocHeading[] = []

  // Strip fenced code blocks before parsing headings
  const stripped = markdown.replace(/```[\s\S]*?```/g, '')

  HEADING_RE.lastIndex = 0
  let match: RegExpExecArray | null = null
  while ((match = HEADING_RE.exec(stripped)) !== null) {
    result.push({
      level: match[1]!.length,
      text: match[2]!.trim(),
      slug: slugify(match[2]!.trim()),
      file,
    })
  }
  return result
}

/* ─── Inline editable title ──────────────────────────────── */

function InlineEditTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }, [draft, value, onSave])

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        className="bg-transparent text-lg font-semibold text-foreground outline-none border-b border-foreground/20 focus:border-foreground/50 w-full max-w-80 py-px"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-2 text-left"
    >
      <span className="text-lg font-semibold text-foreground">{value}</span>
      <PencilIcon className="size-3 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  )
}

/* ─── Document section ───────────────────────────────────── */

function DocumentSection({
  id,
  filename,
  file,
  placeholder,
}: {
  id: string
  filename: string
  file: { content: string | null, loading: boolean, saving: boolean, save: (md: string) => Promise<unknown> }
  placeholder: string
}) {
  if (file.loading) {
    return (
      <div id={id} className="flex items-center gap-2 py-8 text-sm text-muted-foreground/40">
        <Loader2Icon className="size-3.5 animate-spin" />
        正在加载...
      </div>
    )
  }

  if (file.content === null) {
    return null
  }

  return (
    <section id={id}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] font-mono text-muted-foreground/40">{filename}</span>
        {file.saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/40">
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
      {grouped.map(group => {
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
            <span className="block text-[10px] font-mono text-muted-foreground/55 font-medium mb-1.5 px-2">
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
                        : 'text-muted-foreground/40 hover:text-muted-foreground/70',
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

/* ─── Main ───────────────────────────────────────────────── */

export function WorkspaceDetailPage({ workspaceId }: WorkspaceDetailPageProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)

  const { data: workspace } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => ipc ? ipc.workspace.get(workspaceId) : Promise.resolve(undefined),
    enabled: !!workspaceId,
  })

  const { data: gitStatus } = useQuery({
    queryKey: ['git-status', workspace?.path],
    queryFn: () => ipc && workspace?.path ? ipc.git.getStatus(workspace.path) : Promise.resolve(null),
    enabled: !!workspace?.path,
    refetchInterval: 10_000,
  })

  const { data: sessions = [] } = useQuery({
    queryKey: sessionsQueryKey(workspaceId),
    queryFn: () => ipc ? ipc.session.list(workspaceId) : Promise.resolve([]),
    enabled: !!workspaceId,
  })

  const agents = useWorkspaceFile(workspaceId, 'AGENTS.md')

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

  // Parse headings for TOC
  const headings = useMemo(() => [
    ...parseHeadings(agents.content, 'AGENTS.md'),
  ], [agents.content])

  const handleRename = useCallback(async (newName: string) => {
    if (!ipc) return
    await ipc.workspace.update({ id: workspaceId, name: newName })
    await queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
  }, [workspaceId, queryClient])

  const handleOpenInFinder = useCallback(() => {
    if (!ipc || !workspace?.path) return
    ipc.workspace.openInFinder(workspace.path)
  }, [workspace])

  const handleOpenInApp = useCallback(async () => {
    if (!ipc || !workspace?.path) return
    await ipc.workspace.openInDefaultApp(workspace.path)
  }, [workspace])

  const handleNewChat = useCallback(() => {
    void navigate({ to: '/new-chat' })
  }, [navigate])

  const handleTocNavigate = useCallback((slug: string) => {
    const el = document.getElementById(slug)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSlug(slug)
    }
  }, [])

  // Track scroll position for active heading
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const handleScroll = () => {
      // Find all heading elements in the editor
      const headingEls = container.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')
      let active: string | null = null

      for (const el of headingEls) {
        const rect = el.getBoundingClientRect()
        if (rect.top <= 140) {
          active = el.id
        }
      }

      setActiveSlug(active)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  if (!workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Main scrollable content ────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-w-0 [&::-webkit-scrollbar]:hidden">
        <motion.div
          className="max-w-2xl mx-auto py-6 px-2"
        >
          {/* Header */}
          <div className="mb-8">
            <InlineEditTitle value={workspace.name} onSave={handleRename} />
            <p className="text-[12px] text-muted-foreground/35 font-mono mt-1 truncate">
              {workspace.path}
            </p>
          </div>

          {/* AGENTS section */}
          <DocumentSection
            id="section-agents"
            filename="AGENTS.md"
            file={agents}
            placeholder="配置 Agent 指令..."
          />

          {/* Empty state */}
          {agents.content === null && !agents.loading && (
            <div className="py-16 text-center text-sm text-muted-foreground/40">
              该项目中没有 AGENTS.md 文件
            </div>
          )}

          <div className="h-16" />
        </motion.div>
      </div>

      {/* ── Float TOC (right of content, before sidebar) ──── */}
      {headings.length > 0 && (
        <FloatingToc
          headings={headings}
          activeSlug={activeSlug}
          onNavigate={handleTocNavigate}
        />
      )}

      {/* ── Right sidebar ──────────────────────────────────── */}
      <motion.div
        className="w-62 shrink-0 border-l border-border/30 overflow-y-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.25 }}
      >
        {/* Actions */}
        <div className="px-3 pt-3 pb-2 space-y-1">
          <button
            type="button"
            onClick={handleOpenInFinder}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <FolderOpenIcon className="size-3.5" />
            在 Finder 中打开
          </button>
          <button
            type="button"
            onClick={() => void handleOpenInApp()}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-[12px] text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <ExternalLinkIcon className="size-3.5" />
            在编辑器中打开
          </button>
        </div>

        <div className="h-px bg-border/30 mx-3" />

        {/* Properties */}
        <div className="px-3 py-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">分支</span>
            <span className="text-[12px] text-muted-foreground/60 font-mono truncate max-w-28">{gitStatus?.branch ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">会话</span>
            <span className="text-[12px] text-muted-foreground/60">{sessions.length}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">创建</span>
            <span className="text-[12px] text-muted-foreground/60">{formatDate(workspace.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">更新</span>
            <span className="text-[12px] text-muted-foreground/60">{formatDate(workspace.updatedAt)}</span>
          </div>
        </div>

        <div className="h-px bg-border/30 mx-3" />

        {/* Recent sessions */}
        <div className="px-3 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground/45 select-none">最近会话</span>
            <Button variant="ghost" size="icon-xs" onClick={handleNewChat} aria-label="新建聊天">
              <MessageSquarePlusIcon className="size-3" />
            </Button>
          </div>

          {recentSessions.length === 0
            ? (
              <p className="py-4 text-[11px] text-muted-foreground/40 text-center">暂无会话</p>
            )
            : (
              <div className="flex flex-col gap-0.5 pb-3">
                {recentSessions.map((session, i) => (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.03, duration: 0.2 }}
                  >
                    <Link
                      to="/chat/$sessionId"
                      params={{ sessionId: session.id }}
                      search={{ tearoff: false }}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors hover:bg-accent/50"
                    >
                      <MessageSquareIcon className="size-2.5 shrink-0 text-muted-foreground/35" />
                      <span className="truncate flex-1 text-foreground/80">{session.title || 'Untitled'}</span>
                      <time dateTime={new Date(session.updatedAt * 1000).toISOString()} className="shrink-0 text-[10px] text-muted-foreground/35 tabular-nums">
                        {timeAgo(session.updatedAt)}
                      </time>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
        </div>
      </motion.div>
    </div>
  )
}
