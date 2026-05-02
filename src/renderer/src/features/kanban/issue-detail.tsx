// Input: issueId, workspaceId, use-kanban hooks, useAgentProfiles, useAgents, MarkdownEditor, coss UI, motion/react
// Output: IssueDetail — issue detail panel with Symphony-inspired Agent Orchestrator trigger mechanism
// Position: Rendered inside the board view when an issue is selected

import type { KanbanIssue, KanbanIssueComment, KanbanIssueRelation } from '@main/ipc-types'
import { MarkdownEditor } from '@renderer/components/editor/markdown-editor'
import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from '@renderer/components/ui/combobox'
import { Kbd } from '@renderer/components/ui/kbd'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '@renderer/components/ui/menu'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { cn } from '@renderer/lib/cn'
import { useCradleNavigation } from '@renderer/tabs/use-cradle-navigation'
import {
  AlertCircleIcon,
  BotIcon,
  BrainIcon,
  ChevronRightIcon,
  FileIcon,
  GlobeIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
  WrenchIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'
import {
  useAddComment,
  useAddContextRef,
  useAddRelation,
  useAgentActivities,
  useAgentSessions,
  useComments,
  useCreateIssue,
  useDelegateIssue,
  useDeleteComment,
  useDeleteIssue,
  useDeleteRelation,
  useIssue,
  useIssues,
  useMilestones,
  useRelations,
  useRemoveContextRef,
  useStartAgentSession,
  useStatuses,
  useUndelegateIssue,
  useUpdateIssue,
} from './use-kanban'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IssueDetailProps {
  issueId: string
  workspaceId: string
  onClose: () => void
  onNavigateToIssue?: (issueId: string) => void
}

interface ContextRef {
  type: 'file' | 'url' | 'text'
  value: string
  label?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const RELATION_TYPES = [
  { value: 'relates_to', label: 'Relates to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'duplicates', label: 'Duplicates' },
] as const

const SESSION_PHASE: Record<string, { label: string, color: string, pulse: boolean }> = {
  created: { label: 'Queued', color: 'bg-muted-foreground/40', pulse: false },
  active: { label: 'Running', color: 'bg-emerald-500', pulse: true },
  completed: { label: 'Completed', color: 'bg-emerald-500', pulse: false },
  stopped: { label: 'Stopped', color: 'bg-amber-500', pulse: false },
  failed: { label: 'Failed', color: 'bg-red-500', pulse: false },
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function relativeTime(unixTs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixTs
  if (secs < 60) {
    return 'just now'
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m ago`
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h ago`
  }
  return `${Math.floor(secs / 86400)}d ago`
}

const propertyTriggerCls = cn(
  'h-7 border-0 shadow-none text-[12px] px-2 rounded-md',
  'bg-transparent hover:bg-foreground/4 transition-colors duration-100',
  '[&>[data-slot=select-icon]]:hidden',
)

// ── EditableTitle ─────────────────────────────────────────────────────────────

function EditableTitle({ value, onSave }: { value: string, onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.select()
      ref.current.style.height = 'auto'
      ref.current.style.height = `${ref.current.scrollHeight}px`
    }
  }, [editing])

  function commit() {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== value) {
      onSave(t)
    }
    else {
      setDraft(value)
    }
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="w-full text-lg font-semibold bg-transparent outline-none text-foreground leading-snug resize-none overflow-hidden"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onBlur={commit}
        rows={1}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <h1
      className="text-lg font-semibold text-foreground leading-snug text-wrap-pretty cursor-text"
      onClick={() => setEditing(true)}
    >
      {value}
    </h1>
  )
}

// ── Property Row ──────────────────────────────────────────────────────────────

function PropertyRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center min-h-8">
      <span className="text-[11px] text-muted-foreground select-none">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ── Agent Activity Feed ───────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, typeof BrainIcon> = {
  thought: BrainIcon,
  action: WrenchIcon,
  response: MessageSquareIcon,
  error: AlertCircleIcon,
  prompt: UserIcon,
}

function AgentActivityFeed({ sessionId }: { sessionId: string }) {
  const { data: activities = [] } = useAgentActivities(sessionId)
  const [expanded, setExpanded] = useState(false)

  const reasoning = activities.filter(a => a.type === 'thought' || a.type === 'action')
  const responses = activities.filter(a => a.type !== 'thought' && a.type !== 'action')

  function parseBody(activity: (typeof activities)[number]) {
    try {
      const parsed = JSON.parse(activity.content) as Record<string, unknown>
      if (activity.type === 'action') {
        return `${parsed.action ?? 'action'}(${typeof parsed.parameter === 'string' ? parsed.parameter : '...'})`
      }
      return (parsed.body as string) ?? ''
    }
    catch {
      return activity.content
    }
  }

  if (activities.length === 0) {
    return null
  }

  return (
    <div className="space-y-1.5">
      {reasoning.length > 0 && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-100"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRightIcon
            className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')}
          />
          {reasoning.length}
          {' '}
          reasoning step
          {reasoning.length !== 1 ? 's' : ''}
        </button>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.12 }}
            className="ml-3 border-l border-foreground/6 pl-3 space-y-1 overflow-hidden"
          >
            {reasoning.map((a) => {
              const Icon = ACTIVITY_ICON[a.type] ?? BrainIcon
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-2 text-[11px] text-muted-foreground/50"
                >
                  <Icon className="mt-0.5 size-3 shrink-0" />
                  <span className="whitespace-pre-wrap min-w-0 wrap-break-word">
                    {parseBody(a)}
                  </span>
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {responses.map((a) => {
        const Icon = ACTIVITY_ICON[a.type] ?? MessageSquareIcon
        const isError = a.type === 'error'
        return (
          <div
            key={a.id}
            className={cn(
              'flex items-start gap-2 text-[12px]',
              isError ? 'text-red-500' : 'text-foreground/80',
            )}
          >
            <Icon className="mt-0.5 size-3 shrink-0" />
            <span className="whitespace-pre-wrap min-w-0 wrap-break-word leading-relaxed">
              {parseBody(a)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Agent Property Row (Linear-style inline) ──────────────────────────────────

function AgentPropertyRow({
  issueId,
  delegateAgentId,
  onDelegate,
  onUndelegate,
}: {
  issueId: string
  delegateAgentId: string | null | undefined
  onDelegate: (agentProfileId: string, agentId?: string) => void
  onUndelegate: () => void
}) {
  const { profiles = [] } = useAgentProfiles()
  const { agents = [] } = useAgents()
  const { data: sessions = [] } = useAgentSessions(issueId)
  const startSession = useStartAgentSession()

  const enabledAgents = agents.filter(a => a.enabled)
  const enabledProfiles = profiles.filter(p => p.enabled)
  const latestSession = sessions[0]
  const isActive = latestSession?.status === 'active'
  const isQueued = latestSession?.status === 'created'
  const isRunning = isActive || isQueued
  const isFinished
    = latestSession?.status === 'completed'
    || latestSession?.status === 'failed'
    || latestSession?.status === 'stopped'
  const phase = latestSession
    ? (SESSION_PHASE[latestSession.status] ?? SESSION_PHASE.created)
    : null

  const currentAgent = enabledAgents.find(a => a.providerId === delegateAgentId)
  const currentProfile = currentAgent ?? enabledProfiles.find(p => p.id === delegateAgentId)

  // Compute select value for current assignment
  const selectValue = delegateAgentId
    ? currentAgent
      ? `agent:${currentAgent.id}`
      : `profile:${delegateAgentId}`
    : ''

  return (
    <PropertyRow label="Agent">
      <div className="flex items-center gap-1.5">
        <Select
          value={selectValue}
          onValueChange={(val) => {
            if (!val) {
              onUndelegate()
            }
            else if (val.startsWith('agent:')) {
              const agentEntity = enabledAgents.find(a => a.id === val.slice(6))
              if (agentEntity) {
                onDelegate(agentEntity.providerId, agentEntity.id)
              }
            }
            else if (val.startsWith('profile:')) {
              onDelegate(val.slice(8))
            }
          }}
        >
          <SelectTrigger size="sm" className={propertyTriggerCls}>
            {delegateAgentId
              ? (
                <span className="flex items-center gap-1.5">
                  {currentAgent?.avatarUrl
                    ? (
                      <img
                        src={currentAgent.avatarUrl}
                        alt=""
                        className="size-3.5 rounded"
                        crossOrigin="anonymous"
                      />
                    )
                    : (
                      <BotIcon className="size-3 text-muted-foreground/50" />
                    )}
                  <span>{currentProfile?.name ?? 'Agent'}</span>
                  {phase && (
                    <span
                      className={cn(
                        'size-1.5 rounded-full shrink-0',
                        phase.color,
                        phase.pulse && 'animate-pulse',
                      )}
                    />
                  )}
                </span>
              )
              : (
                <span className="text-muted-foreground">No agent</span>
              )}
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4} align="end">
            <SelectItem value="">
              <span className="text-muted-foreground">No agent</span>
            </SelectItem>
            {enabledAgents.map(a => (
              <SelectItem key={a.id} value={`agent:${a.id}`}>
                <span className="flex items-center gap-2">
                  {a.avatarUrl
                    ? (
                      <img
                        src={a.avatarUrl}
                        alt=""
                        className="size-3.5 rounded"
                        crossOrigin="anonymous"
                      />
                    )
                    : (
                      <BotIcon className="size-3 text-muted-foreground/50" />
                    )}
                  {a.name}
                </span>
              </SelectItem>
            ))}
            {enabledAgents.length === 0
              && enabledProfiles.map(p => (
                <SelectItem key={p.id} value={`profile:${p.id}`}>
                  <span className="flex items-center gap-2">
                    <BotIcon className="size-3 text-muted-foreground/50" />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {/* Re-run — only after session finished (completed/failed/stopped) */}
        {delegateAgentId && isFinished && latestSession && (
          <button
            className="flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors duration-100 inset-shadow-[0_1px_--theme(--color-white/15%)]"
            onClick={() => {
              startSession.mutate({
                issueId,
                agentSessionId: latestSession.id,
                agentProfileId: latestSession.agentProfileId,
              })
            }}
          >
            <PlayIcon className="size-2.5" />
            Re-run
          </button>
        )}

        {/* Running indicator */}
        {delegateAgentId && isRunning && (
          <span className="text-[10px] text-emerald-500 animate-pulse">Running</span>
        )}
      </div>
    </PropertyRow>
  )
}

// ── Agent Session Feed (below properties, flat) ──────────────────────────────

function AgentSessionFeed({ issueId }: { issueId: string }) {
  const { data: sessions = [] } = useAgentSessions(issueId)
  const { openTab } = useCradleNavigation()
  const latestSession = sessions[0]

  if (!latestSession) {
    return null
  }

  const phase = SESSION_PHASE[latestSession.status] ?? SESSION_PHASE.created

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Session</span>
        <span
          className={cn('inline-flex items-center gap-1.5 text-[10px] text-muted-foreground')}
        >
          <span
            className={cn('size-1.5 rounded-full', phase.color, phase.pulse && 'animate-pulse')}
          />
          {phase.label}
        </span>
        {latestSession.chatSessionId && (
          <button
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
            onClick={() =>
              openTab('chat', { sessionId: latestSession.chatSessionId! })
            }
          >
            <MessageSquareIcon className="size-2.5" />
            View session
            <ChevronRightIcon className="size-2.5" />
          </button>
        )}
      </div>
      <AgentActivityFeed sessionId={latestSession.id} />
    </div>
  )
}

// ── SubIssueList ──────────────────────────────────────────────────────────────

function SubIssueList({
  workspaceId,
  parentIssueId,
  onNavigate,
}: {
  workspaceId: string
  parentIssueId: string
  onNavigate?: (issueId: string) => void
}) {
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId })
  const createIssue = useCreateIssue()
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (composing) {
      inputRef.current?.focus()
    }
  }, [composing])

  function handleCreate() {
    const title = draft.trim()
    if (!title) {
      setComposing(false)
      return
    }
    createIssue.mutate(
      { workspaceId, title, parentIssueId },
      {
        onSuccess: () => {
          setDraft('')
          inputRef.current?.focus()
        },
      },
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Sub-issues</span>
        {subIssues.length > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {subIssues.length}
          </span>
        )}
        <button
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors duration-100"
          onClick={() => setComposing(true)}
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      {subIssues.length > 0 && (
        <div className="space-y-px">
          {subIssues.map((si: KanbanIssue) => (
            <button
              key={si.id}
              type="button"
              className="flex items-center gap-2 w-full text-left text-[12px] px-2 py-1.5 rounded-md hover:bg-foreground/4 transition-colors duration-100 text-foreground"
              onClick={() => onNavigate?.(si.id)}
            >
              <span className="size-1.5 rounded-full bg-muted-foreground/20 shrink-0" />
              <span className="truncate flex-1">{si.title}</span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Sub-issue title…"
              className="w-full text-[12px] bg-foreground/3 rounded-md px-2.5 py-1.5 outline-none placeholder:text-muted-foreground/30 transition-colors duration-100 inset-shadow-[0_1px_--theme(--color-white/10%)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreate()
                }
                if (e.key === 'Escape') {
                  setDraft('')
                  setComposing(false)
                }
              }}
              onBlur={() => {
                if (!draft.trim()) {
                  setComposing(false)
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Activity Entry ────────────────────────────────────────────────────────────

function ActivityEntry({ comment, issueId }: { comment: KanbanIssueComment, issueId: string }) {
  const deleteComment = useDeleteComment()
  const kind = (comment.authorKind ?? 'user') as 'user' | 'agent' | 'system'

  if (kind === 'system') {
    return (
      <div className="relative flex items-center gap-3 py-2 pl-7">
        <span className="text-[11px] text-muted-foreground italic">{comment.content}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {relativeTime(comment.createdAt)}
        </span>
      </div>
    )
  }

  const isAgent = kind === 'agent'

  return (
    <div className="group/entry relative flex gap-3 py-2" data-testid={`comment-${comment.id}`}>
      <Avatar className="size-5 shrink-0 bg-foreground/4 text-foreground z-10">
        <AvatarFallback className="text-[9px]">
          {isAgent ? <BotIcon className="size-2.5" /> : 'Me'}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 pt-px">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {isAgent ? 'Agent' : 'Me'}
          </span>
          <span className="text-[10px] text-muted-foreground/30 tabular-nums">
            {relativeTime(comment.createdAt)}
          </span>
          <button
            className="text-[10px] text-muted-foreground/20 hover:text-red-500 transition-colors duration-100 opacity-0 group-hover/entry:opacity-100 ml-auto"
            onClick={() => deleteComment.mutate({ id: comment.id, issueId })}
          >
            Delete
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-foreground/80 whitespace-pre-wrap mt-1">
          {comment.content}
        </p>
      </div>
    </div>
  )
}

// ── Compose Comment ───────────────────────────────────────────────────────────

function ComposeComment({ issueId }: { issueId: string }) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const addComment = useAddComment()

  function handleAdd() {
    const content = draft.trim()
    if (!content) {
      return
    }
    addComment.mutate(
      { issueId, content },
      {
        onSuccess: () => setDraft(''),
      },
    )
  }

  return (
    <div className="relative flex gap-3 pt-2">
      <Avatar className="size-5 shrink-0 bg-foreground/4 text-foreground z-10">
        <AvatarFallback className="text-[9px]">Me</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <Textarea
          data-testid="issue-comment-input"
          placeholder="Leave a comment…"
          value={draft}
          rows={focused || draft ? 3 : 1}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="resize-none text-[12px] bg-foreground/2 border-0 shadow-none rounded-md transition-all duration-150 inset-shadow-[0_1px_--theme(--color-white/10%)]"
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleAdd()
            }
          }}
        />
        {(focused || draft) && (
          <div className="flex items-center justify-between mt-1.5">
            <Kbd className="text-[10px]">⌘↵</Kbd>
            <button
              data-testid="issue-comment-submit"
              className={cn(
                'h-6 px-3 text-[11px] font-medium rounded-md transition-colors duration-100',
                'bg-foreground text-background hover:bg-foreground/90 inset-shadow-[0_1px_--theme(--color-white/15%)]',
                'disabled:opacity-30',
              )}
              disabled={!draft.trim() || addComment.isPending}
              onClick={handleAdd}
            >
              Comment
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Relation List ─────────────────────────────────────────────────────────────

function RelatedIssueTitle({ issueId }: { issueId: string }) {
  const { data: issue } = useIssue(issueId)
  return (
    <span className="text-[11px] truncate flex-1 text-foreground">
      {issue ? issue.title : issueId.substring(0, 8)}
    </span>
  )
}

function RelationList({ issueId, workspaceId }: { issueId: string, workspaceId: string }) {
  const { data: relations = [] } = useRelations(issueId)
  const { data: allIssues = [] } = useIssues({ workspaceId })
  const addRelation = useAddRelation()
  const deleteRelation = useDeleteRelation()
  const [relType, setRelType] = useState<'blocks' | 'duplicates' | 'relates_to'>('relates_to')
  const [showPicker, setShowPicker] = useState(false)

  const relatedIds = new Set(
    relations.flatMap((r: KanbanIssueRelation) => [r.sourceIssueId, r.targetIssueId]),
  )
  const candidates = allIssues.filter(i => i.id !== issueId && !relatedIds.has(i.id))

  function handleSelect(targetId: string | null) {
    if (!targetId) {
      return
    }
    addRelation.mutate(
      { sourceIssueId: issueId, targetIssueId: targetId, type: relType },
      { onSuccess: () => setShowPicker(false) },
    )
  }

  function relationLabel(r: KanbanIssueRelation) {
    if (r.sourceIssueId === issueId) {
      return r.type.replace('_', ' ')
    }
    if (r.type === 'blocks') {
      return 'blocked by'
    }
    if (r.type === 'duplicates') {
      return 'duplicated by'
    }
    return 'relates to'
  }

  function relatedId(r: KanbanIssueRelation) {
    return r.sourceIssueId === issueId ? r.targetIssueId : r.sourceIssueId
  }

  if (relations.length === 0 && !showPicker) {
    return (
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors duration-100"
        onClick={() => setShowPicker(true)}
      >
        <PlusIcon className="size-3" />
        Add relation
      </button>
    )
  }

  return (
    <div className="space-y-1">
      {relations.map((r: KanbanIssueRelation) => (
        <div key={r.id} className="flex items-center gap-2 group/rel">
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-3.5 shrink-0 font-normal text-muted-foreground/50"
          >
            {relationLabel(r)}
          </Badge>
          <RelatedIssueTitle issueId={relatedId(r)} />
          <button
            className="text-muted-foreground/20 hover:text-red-500 transition-colors duration-100 opacity-0 group-hover/rel:opacity-100"
            onClick={() => deleteRelation.mutate({ id: r.id, issueId })}
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}

      {showPicker
        ? (
          <div className="space-y-1.5">
            <div className="flex gap-1">
              {RELATION_TYPES.map(t => (
                <button
                  key={t.value}
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded-md transition-colors duration-100',
                    relType === t.value
                      ? 'bg-foreground/6 text-foreground'
                      : 'text-muted-foreground/40 hover:text-foreground',
                  )}
                  onClick={() => setRelType(t.value as typeof relType)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Combobox<string> value={null} onValueChange={handleSelect}>
              <ComboboxInput
                className="h-7"
                placeholder="Search issues…"
                startAddon={<LinkIcon />}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setShowPicker(false)
                  }
                }}
              />
              <ComboboxContent>
                {candidates.map(i => (
                  <ComboboxItem key={i.id} value={i.id}>
                    <span className="truncate">{i.title}</span>
                  </ComboboxItem>
                ))}
                {candidates.length === 0 && (
                  <div className="px-2 py-3 text-center text-[11px] text-muted-foreground/40">
                    No issues available
                  </div>
                )}
              </ComboboxContent>
            </Combobox>
            <button
              className="text-[10px] text-muted-foreground/30 hover:text-foreground transition-colors duration-100"
              onClick={() => setShowPicker(false)}
            >
              Cancel
            </button>
          </div>
        )
        : (
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors duration-100"
            onClick={() => setShowPicker(true)}
          >
            <PlusIcon className="size-3" />
            Add relation
          </button>
        )}
    </div>
  )
}

// ── Context Refs ──────────────────────────────────────────────────────────────

function ContextRefList({ issueId, refs }: { issueId: string, refs: ContextRef[] }) {
  const addRef = useAddContextRef()
  const removeRef = useRemoveContextRef()
  const [input, setInput] = useState('')

  function handleAdd() {
    const v = input.trim()
    if (!v) {
      return
    }
    const ref: ContextRef = v.startsWith('http')
      ? { type: 'url', value: v }
      : { type: 'file', value: v }
    addRef.mutate({ issueId, ref: JSON.stringify(ref) })
    setInput('')
  }

  return (
    <div className="space-y-1">
      {refs.map(r => (
        <div key={`${r.type}-${r.value}`} className="flex items-center gap-2 group/ref">
          {r.type === 'url'
            ? (
              <GlobeIcon className="size-2.5 text-muted-foreground/40 shrink-0" />
            )
            : (
              <FileIcon className="size-2.5 text-muted-foreground/40 shrink-0" />
            )}
          <Tooltip>
            <TooltipTrigger className="flex-1 min-w-0">
              <span className="text-[11px] text-muted-foreground/50 truncate block">
                {r.label ?? r.value}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.value}</TooltipContent>
          </Tooltip>
          <button
            className="text-muted-foreground/20 hover:text-red-500 transition-colors duration-100 opacity-0 group-hover/ref:opacity-100"
            onClick={() => removeRef.mutate({ issueId, index: refs.indexOf(r) })}
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          placeholder="Add path or URL…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAdd()
            }
          }}
          className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/20"
        />
        {input.trim() && (
          <button
            className="text-muted-foreground/40 hover:text-foreground transition-colors duration-100"
            onClick={handleAdd}
          >
            <PlusIcon className="size-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Label Editor ──────────────────────────────────────────────────────────────

function LabelEditor({
  labels,
  onAdd,
  onRemove,
}: {
  labels: string[]
  onAdd: (l: string) => void
  onRemove: (l: string) => void
}) {
  const [input, setInput] = useState('')

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {labels.map(l => (
        <Badge
          key={l}
          variant="secondary"
          className="text-[10px] gap-0.5 px-1.5 h-4.5 group/label cursor-default"
        >
          {l}
          <button
            className="opacity-0 group-hover/label:opacity-100 transition-opacity"
            onClick={() => onRemove(l)}
          >
            <XIcon className="size-2" />
          </button>
        </Badge>
      ))}
      <input
        className="text-[11px] outline-none bg-transparent min-w-12 placeholder:text-muted-foreground/20"
        placeholder={labels.length === 0 ? 'Add label…' : 'Add…'}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
            e.preventDefault()
            onAdd(input.trim())
            setInput('')
          }
        }}
      />
    </div>
  )
}

// ── Main IssueDetail ──────────────────────────────────────────────────────────

export function IssueDetail({
  issueId,
  workspaceId,
  onClose,
  onNavigateToIssue,
}: IssueDetailProps) {
  const { data: issue, isLoading } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: comments = [] } = useComments(issueId)
  const updateIssue = useUpdateIssue()
  const deleteIssue = useDeleteIssue()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const startAgentSession = useStartAgentSession()

  function patch(p: Parameters<typeof updateIssue.mutate>[0]['patch']) {
    if (!issue) {
      return
    }
    updateIssue.mutate({ id: issueId, patch: p })
  }

  if (isLoading || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <span className="text-[12px] text-muted-foreground/30">Loading…</span>
      </div>
    )
  }

  const labels: string[] = (() => {
    try {
      return JSON.parse(issue.labels ?? '[]')
    }
    catch {
      return []
    }
  })()
  const contextRefs: ContextRef[] = (() => {
    try {
      return JSON.parse(issue.contextRefs ?? '[]')
    }
    catch {
      return []
    }
  })()
  const priority = (issue.priority as string) ?? 'none'
  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const currentPriority = PRIORITY_OPTIONS.find(o => o.value === priority)

  return (
    <div data-testid="issue-detail-panel" className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 h-11 shrink-0">
        <span className="text-[10px] text-muted-foreground/30 tabular-nums select-none">
          {issue.id.slice(0, 6).toUpperCase()}
        </span>
        <div className="flex-1" />
        <Menu>
          <MenuTrigger>
            <button className="size-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-foreground/4 transition-colors duration-100">
              <MoreHorizontalIcon className="size-3.5" />
            </button>
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              variant="destructive"
              onClick={() => {
                deleteIssue.mutate(issue.id)
                onClose()
              }}
            >
              <Trash2Icon />
              Delete issue
            </MenuItem>
          </MenuPopup>
        </Menu>
        <button
          className="size-6 flex items-center justify-center rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-foreground/4 transition-colors duration-100"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pb-16 space-y-6">
          {/* Title */}
          <div className="px-5">
            <EditableTitle value={issue.title} onSave={title => patch({ title })} />
          </div>

          {/* Properties — full-width bg */}
          <div className="bg-foreground/2 px-5 py-2 space-y-px inset-shadow-[0_1px_--theme(--color-white/10%)]">
            <PropertyRow label="Status">
              <Select
                value={issue.statusId ?? ''}
                onValueChange={statusId => patch({ statusId: statusId || null })}
              >
                <SelectTrigger size="sm" className={propertyTriggerCls}>
                  {currentStatus
                    ? (
                      <span className="flex items-center gap-1.5">
                        <StatusIcon color={currentStatus.color} className="size-2.5" />
                        <span>{currentStatus.name}</span>
                      </span>
                    )
                    : (
                      <span className="text-muted-foreground/30">None</span>
                    )}
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} align="end">
                  <SelectItem value="">
                    <span className="text-muted-foreground/30">None</span>
                  </SelectItem>
                  {statuses.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <StatusIcon color={s.color} className="size-2.5" />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            <PropertyRow label="Priority">
              <Select
                value={priority}
                onValueChange={p =>
                  patch({ priority: p as 'none' | 'low' | 'medium' | 'high' | 'urgent' })}
              >
                <SelectTrigger size="sm" className={propertyTriggerCls}>
                  <span className="flex items-center gap-1.5">
                    <PriorityIcon priority={priority} className="size-3" />
                    <span>{currentPriority?.label ?? 'No priority'}</span>
                  </span>
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} align="end">
                  {PRIORITY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">
                        <PriorityIcon priority={o.value} className="size-3" />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            <PropertyRow label="Milestone">
              <Select
                value={issue.milestoneId ?? ''}
                onValueChange={milestoneId => patch({ milestoneId: milestoneId || null })}
              >
                <SelectTrigger size="sm" className={propertyTriggerCls}>
                  {currentMilestone
                    ? (
                      <span className="truncate">{currentMilestone.title}</span>
                    )
                    : (
                      <span className="text-muted-foreground/30">None</span>
                    )}
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} align="end">
                  <SelectItem value="">
                    <span className="text-muted-foreground/30">None</span>
                  </SelectItem>
                  {milestones.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PropertyRow>

            <PropertyRow label="Labels">
              <LabelEditor
                labels={labels}
                onAdd={(l) => {
                  if (!labels.includes(l)) {
                    patch({ labels: [...labels, l] })
                  }
                }}
                onRemove={l => patch({ labels: labels.filter(x => x !== l) })}
              />
            </PropertyRow>

            <AgentPropertyRow
              issueId={issueId}
              delegateAgentId={issue.delegateAgentId}
              onDelegate={(agentProfileId, agentId) => {
                delegateIssue.mutate(
                  { issueId, agentProfileId, agentId },
                  {
                    onSuccess: (session) => {
                      if (session?.id) {
                        startAgentSession.mutate({
                          issueId,
                          agentSessionId: session.id,
                          agentProfileId: session.agentProfileId,
                          agentId,
                        })
                      }
                    },
                  },
                )
              }}
              onUndelegate={() => undelegateIssue.mutate({ issueId })}
            />
          </div>

          {/* Agent session activity (flat, below properties) */}
          <div className="px-5">
            {issue.delegateAgentId && <AgentSessionFeed issueId={issueId} />}
          </div>

          {/* Description */}
          <div className="px-5">
            <MarkdownEditor
              content={issue.description ?? ''}
              onSave={(md) => {
                const trimmed = md.trim() || null
                if (trimmed !== issue.description) {
                  patch({ description: trimmed })
                }
              }}
              placeholder="Add a description…"
              className="min-h-16"
            />
          </div>

          {/* Sub-issues + Relations + Context — full-width bg */}
          <div className="bg-foreground/2 px-5 py-4 space-y-5 inset-shadow-[0_1px_--theme(--color-white/10%)]">
            <SubIssueList
              workspaceId={workspaceId}
              parentIssueId={issueId}
              onNavigate={onNavigateToIssue}
            />

            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground/50 block mb-1.5">Relations</span>
              <RelationList issueId={issueId} workspaceId={workspaceId} />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-muted-foreground/50 block mb-1.5">Context</span>
              <ContextRefList issueId={issueId} refs={contextRefs} />
            </div>
          </div>

          {/* Activity — timeline */}
          <div className="px-5">
            <span className="text-[11px] text-muted-foreground/50 block mb-1">Activity</span>
            <div className="relative">
              {/* Timeline connector line */}
              {comments.length > 0 && (
                <div className="absolute left-2.5 top-4 bottom-12 w-px bg-foreground/6" />
              )}
              {comments.map((c: KanbanIssueComment) => (
                <ActivityEntry key={c.id} comment={c} issueId={issueId} />
              ))}
              <ComposeComment issueId={issueId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
