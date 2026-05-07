// Input: issueId, workspaceId, TanStack Query client, use-kanban hooks, useAgentProfiles, useAgents, MarkdownEditor, Combobox, motion/react
// Output: IssueDetail — immersive full-bleed issue detail with frosted-glass layers, cinematic motion, and fluid inline editing
// Position: Rendered inside the board view when an issue is selected

import type { AgentSession, KanbanIssue, KanbanIssueComment, KanbanIssueRelation } from '@main/ipc-types'
import { MarkdownEditor } from '@renderer/components/editor/markdown-editor'
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
import { useQueryClient } from '@tanstack/react-query'
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
import { useCallback, useEffect, useRef, useState } from 'react'

import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'
import {
  useAddComment,
  useAddContextRef,
  useAddRelation,
  kanbanKeys,
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
  boardName?: string
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

const SESSION_PHASE: Record<string, { label: string; color: string; pulse: boolean }> = {
  created: { label: 'Queued', color: 'bg-muted-foreground/40', pulse: false },
  active: { label: 'Running', color: 'bg-emerald-500', pulse: true },
  completed: { label: 'Done', color: 'bg-emerald-500', pulse: false },
  stopped: { label: 'Stopped', color: 'bg-amber-500', pulse: false },
  failed: { label: 'Failed', color: 'bg-red-500', pulse: false },
}

const LABEL_COLORS = [
  'bg-blue-500/8 text-blue-600 dark:text-blue-400',
  'bg-emerald-500/8 text-emerald-600 dark:text-emerald-400',
  'bg-orange-500/8 text-orange-600 dark:text-orange-400',
  'bg-purple-500/8 text-purple-600 dark:text-purple-400',
  'bg-pink-500/8 text-pink-600 dark:text-pink-400',
  'bg-amber-500/8 text-amber-600 dark:text-amber-400',
  'bg-teal-500/8 text-teal-600 dark:text-teal-400',
  'bg-red-500/8 text-red-600 dark:text-red-400',
] as const

const LIVE_AGENT_SESSION_STATUSES = new Set<AgentSession['status']>(['created', 'active'])

function getLabelColor(label: string): string {
  let h = 0
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) | 0
  }
  return LABEL_COLORS[Math.abs(h) % LABEL_COLORS.length]
}

// ── Motion presets ────────────────────────────────────────────────────────────

const springSnap = { type: 'spring' as const, stiffness: 500, damping: 32 }
const springGentle = { type: 'spring' as const, stiffness: 260, damping: 26 }
const fadeSlide = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: springGentle,
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function relativeTime(unixTs: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixTs
  if (secs < 60) {
    return 'just now'
  }
  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m`
  }
  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h`
  }
  return `${Math.floor(secs / 86400)}d`
}

function formatDate(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const propTriggerCls = cn(
  'h-7 border-0 shadow-none text-[12px] px-2 rounded-md',
  'bg-transparent hover:bg-foreground/5 transition-colors duration-150',
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

  const commit = useCallback(() => {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== value) {
      onSave(t)
    }
    else {
      setDraft(value)
    }
  }, [draft, value, onSave])

  if (editing) {
    return (
      <motion.textarea
        ref={ref}
        data-testid="issue-title-input"
        className="w-full text-[26px] font-semibold bg-transparent outline-none text-foreground leading-[1.2] resize-none overflow-hidden tracking-tight"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onBlur={commit}
        rows={1}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        initial={{ opacity: 0.7 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.1 }}
      />
    )
  }

  return (
    <motion.h1
      data-testid="issue-title-display"
      className="text-[26px] font-semibold text-foreground leading-[1.2] tracking-tight text-wrap-pretty cursor-text select-none"
      onClick={() => setEditing(true)}
      whileHover={{ opacity: 0.7 }}
      transition={{ duration: 0.15 }}
    >
      {value}
    </motion.h1>
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

  if (activities.length === 0) return null

  return (
    <div className="space-y-2">
      {reasoning.length > 0 && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors duration-150"
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRightIcon
            className={cn('size-3 transition-transform duration-200', expanded && 'rotate-90')}
          />
          {reasoning.length}
          {' '}
          step{reasoning.length !== 1 ? 's' : ''}
        </button>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="ml-4 border-l border-foreground/6 pl-3 space-y-1.5 overflow-hidden"
          >
            {reasoning.map((a) => {
              const Icon = ACTIVITY_ICON[a.type] ?? BrainIcon
              return (
                <div key={a.id} className="flex items-start gap-2 text-[11px] text-muted-foreground/50">
                  <Icon className="mt-0.5 size-3 shrink-0" />
                  <span className="whitespace-pre-wrap min-w-0 wrap-break-word">{parseBody(a)}</span>
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
            className={cn('flex items-start gap-2 text-[12px]', isError ? 'text-red-500' : 'text-foreground/80')}
          >
            <Icon className="mt-0.5 size-3 shrink-0" />
            <span className="whitespace-pre-wrap min-w-0 wrap-break-word leading-relaxed">{parseBody(a)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Agent Delegate Picker ─────────────────────────────────────────────────────

function AgentDelegatePicker({
  issueId,
  workspaceId,
  delegateAgentId,
  sessions,
  onDelegate,
  onUndelegate,
}: {
  issueId: string
  workspaceId: string
  delegateAgentId: string | null | undefined
  sessions: AgentSession[]
  onDelegate: (agentProfileId: string, agentId?: string) => void
  onUndelegate: () => void
}) {
  const { profiles = [] } = useAgentProfiles()
  const { agents = [] } = useAgents()
  const startSession = useStartAgentSession()

  const enabledAgents = agents.filter(a => a.enabled)
  const enabledProfiles = profiles.filter(p => p.enabled)
  const latestSession = sessions[0]
  const isActive = latestSession?.status === 'active' || latestSession?.status === 'created'
  const isFinished = ['completed', 'failed', 'stopped'].includes(latestSession?.status ?? '')
  const phase = latestSession ? SESSION_PHASE[latestSession.status] ?? SESSION_PHASE.created : null

  const currentAgent = enabledAgents.find(a => a.providerId === delegateAgentId)
  const currentProfile = currentAgent ?? enabledProfiles.find(p => p.id === delegateAgentId)

  const selectValue = delegateAgentId
    ? currentAgent ? `agent:${currentAgent.id}` : `profile:${delegateAgentId}`
    : ''

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectValue}
        onValueChange={(val) => {
          if (!val) { onUndelegate(); return }
          if (val.startsWith('agent:')) {
            const a = enabledAgents.find(x => x.id === val.slice(6))
            if (a) onDelegate(a.providerId, a.id)
          }
          else if (val.startsWith('profile:')) {
            onDelegate(val.slice(8))
          }
        }}
      >
        <SelectTrigger
          size="sm"
          className={propTriggerCls}
          data-agent-delegated={delegateAgentId ? 'true' : 'false'}
          data-testid="issue-agent-delegate-trigger"
        >
          {delegateAgentId
            ? (
              <span className="flex items-center gap-1.5">
                {currentAgent?.avatarUrl
                  ? <img src={currentAgent.avatarUrl} alt="" className="size-3.5 rounded" crossOrigin="anonymous" />
                  : <BotIcon className="size-3 text-muted-foreground/50" />}
                <span className="text-foreground">{currentProfile?.name ?? 'Agent'}</span>
                {phase && (
                  <span className={cn('size-1.5 rounded-full shrink-0', phase.color, phase.pulse && 'animate-pulse')} />
                )}
              </span>
            )
            : <span className="text-muted-foreground/40">Unassigned</span>}
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4} align="start">
          <SelectItem value="" data-testid="issue-agent-option-unassigned"><span className="text-muted-foreground/40">Unassigned</span></SelectItem>
          {enabledAgents.map(a => (
            <SelectItem key={a.id} value={`agent:${a.id}`} data-testid={`issue-agent-option-agent-${a.id}`}>
              <span className="flex items-center gap-2">
                {a.avatarUrl
                  ? <img src={a.avatarUrl} alt="" className="size-3.5 rounded" crossOrigin="anonymous" />
                  : <BotIcon className="size-3 text-muted-foreground/50" />}
                {a.name}
              </span>
            </SelectItem>
          ))}
          {enabledAgents.length === 0 && enabledProfiles.map(p => (
            <SelectItem key={p.id} value={`profile:${p.id}`} data-testid={`issue-agent-option-profile-${p.id}`}>
              <span className="flex items-center gap-2">
                <BotIcon className="size-3 text-muted-foreground/50" />
                {p.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {delegateAgentId && isFinished && latestSession && (
        <motion.button
          data-testid="issue-agent-rerun-btn"
          className="flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-medium bg-foreground/5 text-foreground hover:bg-foreground/10 transition-colors duration-150"
          onClick={() => startSession.mutate({
            issueId,
            workspaceId,
            agentSessionId: latestSession.id,
            agentProfileId: latestSession.agentProfileId,
          })}
          whileTap={{ scale: 0.95 }}
        >
          <PlayIcon className="size-2.5" />
          Re-run
        </motion.button>
      )}
      {delegateAgentId && isActive && (
        <span data-testid="issue-agent-running-indicator" className="text-[10px] text-emerald-500 font-medium animate-pulse">Running</span>
      )}
    </div>
  )
}

// ── Agent Session Feed ────────────────────────────────────────────────────────

function AgentSessionFeed({ latestSession }: { latestSession: AgentSession }) {
  const { openTab } = useCradleNavigation()

  const phase = SESSION_PHASE[latestSession.status] ?? SESSION_PHASE.created

  return (
    <motion.div
      data-testid="issue-agent-session"
      className="rounded-xl bg-foreground/2 backdrop-blur-sm px-4 py-3.5 space-y-3"
      style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.04)' }}
      {...fadeSlide}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-6 items-center justify-center rounded-full bg-foreground/5">
          <BotIcon className="size-3 text-foreground/60" />
        </div>
        <span className="text-[12px] font-medium text-foreground">Agent Session</span>
        <span
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60 ml-auto"
          data-agent-session-status={latestSession.status}
          data-testid="issue-agent-session-phase"
        >
          <span className={cn('size-1.5 rounded-full shrink-0', phase.color, phase.pulse && 'animate-pulse')} />
          {phase.label}
        </span>
        {latestSession.chatSessionId && (
          <button
            data-testid="issue-agent-session-open-chat"
            className="text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors duration-150 flex items-center gap-1"
            onClick={() => openTab('chat', { sessionId: latestSession.chatSessionId! })}
          >
            <MessageSquareIcon className="size-2.5" />
            View
          </button>
        )}
      </div>
      <AgentActivityFeed sessionId={latestSession.id} />
    </motion.div>
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
    if (composing) inputRef.current?.focus()
  }, [composing])

  function handleCreate() {
    const title = draft.trim()
    if (!title) { setComposing(false); return }
    createIssue.mutate(
      { workspaceId, title, parentIssueId },
      { onSuccess: () => { setDraft(''); inputRef.current?.focus() } },
    )
  }

  if (subIssues.length === 0 && !composing) {
    return (
      <button
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors duration-150"
        onClick={() => setComposing(true)}
      >
        <PlusIcon className="size-3" />
        Add sub-issue
      </button>
    )
  }

  return (
    <div className="space-y-1">
      {subIssues.length > 0 && (
        <div className="space-y-px">
          {subIssues.map((si: KanbanIssue, idx: number) => (
            <motion.button
              key={si.id}
              type="button"
              className="flex items-center gap-2.5 w-full text-left text-[12px] px-2.5 py-2 rounded-lg hover:bg-foreground/4 transition-colors duration-150 text-foreground group/sub"
              onClick={() => onNavigate?.(si.id)}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springGentle, delay: idx * 0.03 }}
            >
              <span className="size-1.5 rounded-full bg-foreground/15 shrink-0 group-hover/sub:bg-foreground/30 transition-colors duration-150" />
              <span className="truncate flex-1">{si.title}</span>
              <ChevronRightIcon className="size-3 text-muted-foreground/20 opacity-0 group-hover/sub:opacity-100 transition-opacity duration-150" />
            </motion.button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1">
        {!composing && (
          <button
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors duration-150"
            onClick={() => setComposing(true)}
          >
            <PlusIcon className="size-3" />
            Add
          </button>
        )}
      </div>

      <AnimatePresence>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0, scale: 0.98 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            exit={{ opacity: 0, height: 0, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Title..."
              className="w-full text-[12px] bg-foreground/3 rounded-lg px-3 py-2 outline-none placeholder:text-muted-foreground/25 transition-colors duration-150 focus:bg-foreground/5"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') { setDraft(''); setComposing(false) }
              }}
              onBlur={() => { if (!draft.trim()) setComposing(false) }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Activity Entry ────────────────────────────────────────────────────────────

const SYSTEM_ICON_MAP: Record<string, typeof BotIcon> = {
  'system.delegated': BotIcon,
  'system.undelegated': XIcon,
  'system.status': ChevronRightIcon,
  'system.priority': AlertCircleIcon,
  'system.assign': UserIcon,
  'system.label': LinkIcon,
}

function SystemActivityIcon({ authorKind }: { authorKind: string }) {
  const Icon = SYSTEM_ICON_MAP[authorKind] ?? MessageSquareIcon
  return <Icon className="size-2.5" />
}

function ActivityEntry({ comment, issueId, index }: { comment: KanbanIssueComment, issueId: string, index: number }) {
  const deleteComment = useDeleteComment()
  const kind = comment.authorKind ?? 'user'
  const isSystem = kind === 'system' || kind.startsWith('system.')

  if (isSystem) {
    return (
      <motion.div
        className="flex items-center gap-2.5 py-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.04 }}
      >
        <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SystemActivityIcon authorKind={kind} />
        </div>
        <span className="text-[11px] text-muted-foreground select-none flex-1">{comment.content}</span>
        <span className="text-[10px] text-text-dim tabular-nums shrink-0">{relativeTime(comment.createdAt)}</span>
      </motion.div>
    )
  }

  const isAgent = kind === 'agent'

  return (
    <motion.div
      className="flex gap-3 group/entry"
      data-testid={`comment-${comment.id}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springGentle, delay: index * 0.04 }}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full mt-0.5',
          'bg-muted text-muted-foreground',
        )}
      >
        {isAgent ? <BotIcon className="size-3" /> : <UserIcon className="size-3" />}
      </div>

      {/* Comment body */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {isAgent ? 'Agent' : 'You'}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {relativeTime(comment.createdAt)}
          </span>
          <button
            className="ml-auto text-text-dim hover:text-red-500 transition-colors duration-150 opacity-0 group-hover/entry:opacity-100"
            onClick={() => deleteComment.mutate({ id: comment.id, issueId })}
          >
            <XIcon className="size-3" />
          </button>
        </div>
        <p className="text-[13px] leading-[1.6] text-foreground whitespace-pre-wrap">{comment.content}</p>
      </div>
    </motion.div>
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
    addComment.mutate({ issueId, content }, { onSuccess: () => setDraft('') })
  }

  const isExpanded = focused || !!draft

  return (
    <div className="relative">
      <Textarea
        data-testid="issue-comment-input"
        placeholder="Write a comment..."
        value={draft}
        rows={isExpanded ? 3 : 1}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'resize-none text-[13px] border-border bg-transparent transition-all duration-200',
          isExpanded && 'bg-muted',
        )}
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleAdd()
          }
        }}
      />
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="flex items-center justify-between mt-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Kbd className="text-[10px]">⌘↵</Kbd>
            <button
              data-testid="issue-comment-submit"
              className={cn(
                'h-7 px-4 text-[12px] font-medium rounded-md transition-all duration-150',
                'bg-foreground text-background',
                'disabled:opacity-20',
              )}
              disabled={!draft.trim() || addComment.isPending}
              onClick={handleAdd}
            >
              Send
            </button>
          </motion.div>
        )}
      </AnimatePresence>
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
  const [addingType, setAddingType] = useState<'blocks' | 'duplicates' | 'relates_to' | null>(null)

  const relatedIds = new Set(
    relations.flatMap((r: KanbanIssueRelation) => [r.sourceIssueId, r.targetIssueId]),
  )
  const candidates = allIssues.filter(i => i.id !== issueId && !relatedIds.has(i.id))

  function handleSelect(type: typeof RELATION_TYPES[number]['value'], targetId: string | null) {
    if (!targetId) {
      return
    }
    addRelation.mutate(
      { sourceIssueId: issueId, targetIssueId: targetId, type },
      { onSuccess: () => setAddingType(null) },
    )
  }

  function relatedId(r: KanbanIssueRelation) {
    return r.sourceIssueId === issueId ? r.targetIssueId : r.sourceIssueId
  }

  return (
    <div className="space-y-3">
      {RELATION_TYPES.map((t) => {
        const items = relations.filter((r: KanbanIssueRelation) => {
          if (r.sourceIssueId === issueId) {
            return r.type === t.value
          }
          // Reverse direction
          if (t.value === 'blocks') {
            return r.type === 'blocks' && r.targetIssueId === issueId
          }
          if (t.value === 'duplicates') {
            return r.type === 'duplicates' && r.targetIssueId === issueId
          }
          return r.type === 'relates_to' && r.targetIssueId === issueId
        })
        const isAdding = addingType === t.value

        return (
          <div key={t.value} className="space-y-1">
            {/* Type header with add button */}
            <div className="flex items-center justify-between group/section">
              <span className="text-[10px] text-text-tertiary">{t.label}</span>
              <button
                className="text-text-dim hover:text-foreground transition-colors duration-150 opacity-0 group-hover/section:opacity-100"
                onClick={() => setAddingType(isAdding ? null : t.value as typeof addingType)}
              >
                <PlusIcon className="size-2.5" />
              </button>
            </div>

            {/* Existing relations of this type */}
            {items.map((r: KanbanIssueRelation) => (
              <div key={r.id} className="flex items-center gap-2 group/rel pl-1">
                <RelatedIssueTitle issueId={relatedId(r)} />
                <button
                  className="text-text-dim hover:text-red-500 transition-colors duration-150 opacity-0 group-hover/rel:opacity-100"
                  onClick={() => deleteRelation.mutate({ id: r.id, issueId })}
                >
                  <XIcon className="size-2.5" />
                </button>
              </div>
            ))}

            {/* Inline picker */}
            <AnimatePresence>
              {isAdding && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <Combobox<string> value={null} onValueChange={v => handleSelect(t.value, v)}>
                    <ComboboxInput
                      className="h-7"
                      placeholder="Search..."
                      startAddon={<LinkIcon />}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setAddingType(null)
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
                        <div className="px-2 py-3 text-center text-[11px] text-text-dim">
                          No issues
                        </div>
                      )}
                    </ComboboxContent>
                  </Combobox>
                </motion.div>
              )}
            </AnimatePresence>

            {items.length === 0 && !isAdding && (
              <span className="text-[10px] text-text-dim pl-1">None</span>
            )}
          </div>
        )
      })}
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
    if (!v) return
    const ref: ContextRef = v.startsWith('http')
      ? { type: 'url', value: v }
      : { type: 'file', value: v }
    addRef.mutate({ issueId, ref: JSON.stringify(ref) })
    setInput('')
  }

  return (
    <div className="space-y-1.5">
      {refs.map(r => (
        <div key={`${r.type}-${r.value}`} className="flex items-center gap-2 group/ref">
          {r.type === 'url'
            ? <GlobeIcon className="size-2.5 text-muted-foreground/40 shrink-0" />
            : <FileIcon className="size-2.5 text-muted-foreground/40 shrink-0" />}
          <Tooltip>
            <TooltipTrigger className="flex-1 min-w-0">
              <span className="text-[11px] text-muted-foreground/50 truncate block">
                {r.label ?? r.value}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.value}</TooltipContent>
          </Tooltip>
          <button
            className="text-muted-foreground/20 hover:text-red-500 transition-colors duration-150 opacity-0 group-hover/ref:opacity-100"
            onClick={() => removeRef.mutate({ issueId, index: refs.indexOf(r) })}
          >
            <XIcon className="size-2.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          placeholder="Path or URL..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/20"
        />
        {input.trim() && (
          <button
            className="text-muted-foreground/40 hover:text-foreground transition-colors duration-150"
            onClick={handleAdd}
          >
            <PlusIcon className="size-2.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Property Panel (right column) ─────────────────────────────────────────────

function PropertyPanel({
  issue,
  issueId,
  workspaceId,
  agentSessions,
  statuses,
  milestones,
  labels,
  contextRefs,
  onPatch,
  onDelegate,
  onUndelegate,
}: {
  issue: KanbanIssue
  issueId: string
  workspaceId: string
  agentSessions: AgentSession[]
  statuses: { id: string, name: string, color: string | null }[]
  milestones: { id: string, title: string }[]
  labels: string[]
  contextRefs: ContextRef[]
  onPatch: (p: Record<string, unknown>) => void
  onDelegate: (profileId: string, agentId?: string) => void
  onUndelegate: () => void
}) {
  const [labelInput, setLabelInput] = useState('')
  const priority = (issue.priority as string) ?? 'none'
  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const currentPriority = PRIORITY_OPTIONS.find(o => o.value === priority)

  return (
    <motion.div
      className="w-72 shrink-0 overflow-y-auto flex flex-col border-l border-border"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={springGentle}
    >
      <div className="p-4 space-y-0.5">

        {/* ── Row: Status ── */}
        <div className="flex items-center h-9">
          <span className="w-20 shrink-0 text-[12px] text-muted-foreground">Status</span>
          <Select value={issue.statusId ?? ''} onValueChange={v => onPatch({ statusId: v || null })}>
            <SelectTrigger size="sm" className={propTriggerCls}>
              {currentStatus
                ? (
                  <span className="flex items-center gap-2">
                    <StatusIcon color={currentStatus.color} className="size-2.5" />
                    <span className="text-foreground">{currentStatus.name}</span>
                  </span>
                )
                : <span className="text-text-dim">None</span>}
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} align="start">
              <SelectItem value=""><span className="text-text-dim">None</span></SelectItem>
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
        </div>

        {/* ── Row: Priority ── */}
        <div className="flex items-center h-9">
          <span className="w-20 shrink-0 text-[12px] text-muted-foreground">Priority</span>
          <Select value={priority} onValueChange={p => onPatch({ priority: p })}>
            <SelectTrigger size="sm" className={propTriggerCls} data-testid="issue-priority-trigger">
              <span className="flex items-center gap-2">
                <PriorityIcon priority={priority} className="size-3" />
                <span className="text-foreground">{currentPriority?.label ?? 'No priority'}</span>
              </span>
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} align="start">
              {PRIORITY_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} data-testid={`issue-priority-option-${o.value}`}>
                  <span className="flex items-center gap-2">
                    <PriorityIcon priority={o.value} className="size-3" />
                    {o.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Row: Agent ── */}
        <div className="flex items-center h-9">
          <span className="w-20 shrink-0 text-[12px] text-muted-foreground">Agent</span>
          <AgentDelegatePicker
            issueId={issueId}
            workspaceId={workspaceId}
            delegateAgentId={issue.delegateAgentId}
            sessions={agentSessions}
            onDelegate={onDelegate}
            onUndelegate={onUndelegate}
          />
        </div>

        {/* ── Row: Milestone ── */}
        <div className="flex items-center h-9">
          <span className="w-20 shrink-0 text-[12px] text-muted-foreground">Milestone</span>
          <Select value={issue.milestoneId ?? ''} onValueChange={v => onPatch({ milestoneId: v || null })}>
            <SelectTrigger size="sm" className={propTriggerCls}>
              {currentMilestone
                ? <span className="text-foreground truncate">{currentMilestone.title}</span>
                : <span className="text-text-dim">None</span>}
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} align="start">
              <SelectItem value=""><span className="text-text-dim">None</span></SelectItem>
              {milestones.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Section: Labels ── */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <span className="text-[12px] text-muted-foreground">Labels</span>
        <div className="flex flex-wrap gap-1.5 items-center">
          {labels.map(l => (
            <motion.span
              key={l}
              className={cn(
                'group/lbl inline-flex items-center gap-1 rounded-md text-[10px] font-medium px-2 h-5 cursor-default',
                getLabelColor(l),
              )}
              layout
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={springSnap}
            >
              {l}
              <button
                className="opacity-0 group-hover/lbl:opacity-100 transition-opacity duration-150 -mr-0.5"
                onClick={() => onPatch({ labels: labels.filter(x => x !== l) })}
              >
                <XIcon className="size-2.5" />
              </button>
            </motion.span>
          ))}
          <input
            className="text-[11px] outline-none bg-transparent min-w-15 placeholder:text-text-dim h-5"
            placeholder={labels.length === 0 ? 'Add label...' : '+'}
            value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ',') && labelInput.trim()) {
                e.preventDefault()
                const nl = labelInput.trim()
                if (!labels.includes(nl)) {
                  onPatch({ labels: [...labels, nl] })
                }
                setLabelInput('')
              }
            }}
          />
        </div>
      </div>

      {/* ── Section: Relations ── */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <span className="text-[12px] text-muted-foreground">Relations</span>
        <RelationList issueId={issueId} workspaceId={workspaceId} />
      </div>

      {/* ── Section: Context ── */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        <span className="text-[12px] text-muted-foreground">Context</span>
        <ContextRefList issueId={issueId} refs={contextRefs} />
      </div>

      {/* ── Footer: Meta ── */}
      <div className="mt-auto px-4 py-3 border-t border-border space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Created</span>
          <span className="text-[11px] text-foreground tabular-nums">{formatDate(issue.createdAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">ID</span>
          <span className="text-[11px] text-foreground font-mono">{issue.id.slice(0, 8)}</span>
        </div>
      </div>
    </motion.div>
  )
}

// ── Main IssueDetail ──────────────────────────────────────────────────────────

export function IssueDetail({
  issueId,
  workspaceId,
  onClose,
  onNavigateToIssue,
  boardName,
}: IssueDetailProps) {
  const queryClient = useQueryClient()
  const { data: issue, isLoading } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: comments = [] } = useComments(issueId)
  const { data: agentSessions = [] } = useAgentSessions(issueId)
  const updateIssue = useUpdateIssue()
  const deleteIssue = useDeleteIssue()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const startAgentSession = useStartAgentSession()
  const scrollRef = useRef<HTMLDivElement>(null)
  const latestAgentSession = agentSessions[0] ?? null

  function patch(p: Parameters<typeof updateIssue.mutate>[0]['patch']) {
    if (!issue) return
    updateIssue.mutate({ id: issueId, patch: p })
  }

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!latestAgentSession || !LIVE_AGENT_SESSION_STATUSES.has(latestAgentSession.status)) {
      return
    }

    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.agentSessions(issueId) })
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.agentActivities(latestAgentSession.id) })
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.comments(issueId) })
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.issue(issueId) })
      void queryClient.invalidateQueries({ queryKey: ['kanban', 'issues'] })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [issueId, latestAgentSession, queryClient])

  if (isLoading || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <motion.div
          className="size-5 rounded-full border-2 border-foreground/10 border-t-foreground/40"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        />
      </div>
    )
  }

  const labels: string[] = (() => {
    try { return JSON.parse(issue.labels ?? '[]') }
    catch { return [] }
  })()
  const contextRefs: ContextRef[] = (() => {
    try { return JSON.parse(issue.contextRefs ?? '[]') }
    catch { return [] }
  })()

  return (
    <motion.div
      data-testid="issue-detail-panel"
      data-issue-id={issue.id}
      className="flex h-full flex-col bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* ── Top bar — frosted glass ──────────────────────── */}
      <div
        data-testid="issue-detail-header"
        className="flex items-center gap-3 px-5 h-12 shrink-0 backdrop-blur-xl bg-background/70 border-b border-border z-10"
      >
        <motion.button
          data-testid="issue-detail-close-btn"
          className="flex items-center justify-center size-7 rounded-lg text-text-tertiary hover:text-foreground hover:bg-accent transition-colors duration-150"
          onClick={onClose}
          whileTap={{ scale: 0.9 }}
        >
          <XIcon className="size-3.5" />
        </motion.button>

        <div className="flex items-center gap-1.5 text-[12px] text-text-dim">
          <span className="hover:text-foreground cursor-pointer transition-colors duration-150" onClick={onClose}>
            {boardName ?? 'Issues'}
          </span>
          <ChevronRightIcon className="size-3 text-text-dim" />
          <span className="font-mono text-text-tertiary">
            {issue.id.slice(0, 8).toUpperCase()}
          </span>
        </div>

        <div className="flex-1" />

        <Menu>
          <MenuTrigger>
            <motion.button
              data-testid="issue-detail-menu-trigger"
              className="size-7 flex items-center justify-center rounded-lg text-text-dim hover:text-foreground hover:bg-accent transition-colors duration-150"
              whileTap={{ scale: 0.9 }}
            >
              <MoreHorizontalIcon className="size-3.5" />
            </motion.button>
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              variant="destructive"
              data-testid="issue-detail-delete-issue"
              onClick={() => { deleteIssue.mutate(issue.id); onClose() }}
            >
              <Trash2Icon />
              Delete issue
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {/* ── Two-column body ──────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Main content ── */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto scroll-smooth">
          <motion.div
            className="px-10 pt-10 pb-32 max-w-170 mx-auto"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springGentle, delay: 0.05 }}
          >
            {/* Title */}
            <EditableTitle value={issue.title} onSave={title => patch({ title })} />

            {/* Description */}
            <motion.div
              data-testid="issue-description-editor"
              className="mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12 }}
            >
              <MarkdownEditor
                content={issue.description ?? ''}
                onSave={(md) => {
                  const trimmed = md.trim() || null
                  if (trimmed !== issue.description) patch({ description: trimmed })
                }}
                placeholder="Add a description..."
                className="min-h-24"
              />
            </motion.div>

            {/* Sub-issues */}
            <motion.div
              className="mt-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <span className="text-[11px] text-text-dim select-none mb-3 block">Sub-issues</span>
              <SubIssueList
                workspaceId={workspaceId}
                parentIssueId={issueId}
                onNavigate={onNavigateToIssue}
              />
            </motion.div>

            {/* Agent session */}
            {issue.delegateAgentId && latestAgentSession && (
              <div className="mt-8">
                <AgentSessionFeed latestSession={latestAgentSession} />
              </div>
            )}

            {/* Activity timeline */}
            <motion.div
              className="mt-10"
              data-testid="issue-activity-timeline"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <span className="text-[11px] text-text-dim select-none mb-5 block">Activity</span>
              <div className="space-y-4">
                {comments.map((c: KanbanIssueComment, idx: number) => (
                  <ActivityEntry key={c.id} comment={c} issueId={issueId} index={idx} />
                ))}
              </div>
              <div className="mt-6">
                <ComposeComment issueId={issueId} />
              </div>
            </motion.div>
          </motion.div>
        </div>

        {/* ── Property panel ── */}
        <PropertyPanel
          issue={issue}
          issueId={issueId}
          workspaceId={workspaceId}
          agentSessions={agentSessions}
          statuses={statuses}
          milestones={milestones}
          labels={labels}
          contextRefs={contextRefs}
          onPatch={p => patch(p as Parameters<typeof updateIssue.mutate>[0]['patch'])}
          onDelegate={(agentProfileId, agentId) => {
            delegateIssue.mutate(
              { issueId, agentProfileId, agentId },
              {
                onSuccess: (session) => {
                  if (session?.id) {
                    startAgentSession.mutate({
                      issueId,
                      workspaceId,
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
    </motion.div>
  )
}
