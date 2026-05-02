// Input: KanbanIssue id, use-kanban hooks, useAgentProfiles, useAgents, MarkdownEditor, coss UI, motion/react
// Output: IssuePanel — full-page issue detail + IssueProperties aside (delegate picker with Agent avatars, agent session, activity feed)
// Position: Route page component rendered via kanban/$boardId/$issueId

import type { KanbanIssue, KanbanIssueComment, KanbanIssueRelation } from '@main/ipc-types'
import { MarkdownEditor } from '@renderer/components/editor/markdown-editor'
import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem
} from '@renderer/components/ui/combobox'
import { Kbd } from '@renderer/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { cn } from '@renderer/lib/cn'
import {
  AlertCircleIcon,
  BotIcon,
  BrainIcon,
  ChevronRightIcon,
  CircleStopIcon,
  FileIcon,
  GlobeIcon,
  LinkIcon,
  MessageSquareIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
  WrenchIcon,
  XIcon
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
  useDeleteRelation,
  useIssue,
  useIssues,
  useMilestones,
  useRelations,
  useRemoveContextRef,
  useStartAgentSession,
  useStatuses,
  useStopAgentSession,
  useUndelegateIssue,
  useUpdateIssue
} from './use-kanban'

// ── Constants ─────────────────────────────────────────────────────────────────

interface IssuePanelProps {
  issueId: string
  workspaceId: string
}

interface ContextRef {
  type: 'file' | 'url' | 'text'
  value: string
  label?: string
}

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
]

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

// ── EditableTitle ─────────────────────────────────────────────────────────────

function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) {
      ref.current?.select()
    }
  }, [editing])

  function commit() {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== value) {
      onSave(t)
    } else {
      setDraft(value)
    }
  }

  if (editing) {
    return (
      <input
        ref={ref}
        className="w-full text-[22px] font-semibold bg-transparent outline-none text-foreground leading-snug"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
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
      className="text-[22px] font-semibold text-foreground leading-snug text-wrap-pretty cursor-text hover:text-foreground/90 transition-colors"
      onClick={() => setEditing(true)}
    >
      {value}
    </h1>
  )
}

// ── ComposeComment ─────────────────────────────────────────────────────────────

function ComposeComment({ issueId }: { issueId: string }) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const addComment = useAddComment()

  function handleAdd() {
    const content = draft.trim()
    if (!content) {
      return
    }
    addComment.mutate(
      { issueId, content },
      {
        onSuccess: () => {
          setDraft('')
          setFocused(false)
        }
      }
    )
  }

  return (
    <div className="flex gap-3 mt-5">
      <Avatar className="size-6 mt-1 shrink-0 bg-foreground/5 text-foreground">
        <AvatarFallback className="text-[10px] font-medium">Me</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <Textarea
          data-testid="issue-comment-input"
          placeholder="Leave a comment…"
          value={draft}
          rows={focused ? 4 : 1}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            if (!draft.trim()) {
              setFocused(false)
            }
          }}
          className={cn(
            'resize-none text-[13px] transition-all duration-150',
            'border border-foreground/15 rounded-md',
            'bg-foreground/2 focus:bg-background',
            focused ? 'min-h-20' : 'min-h-9'
          )}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleAdd()
            }
          }}
        />
        <AnimatePresence>
          {focused && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="flex items-center justify-between overflow-hidden"
            >
              <Kbd className="text-[11px]">⌘↵</Kbd>
              <button
                data-testid="issue-comment-submit"
                className={cn(
                  'h-7 px-3.5 text-[12px] font-medium rounded-md transition-colors',
                  'bg-foreground text-background hover:bg-foreground/90',
                  'disabled:opacity-50 disabled:pointer-events-none'
                )}
                disabled={!draft.trim() || addComment.isPending}
                onClick={handleAdd}
              >
                Comment
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Activity timeline ─────────────────────────────────────────────────────────

function ActivityEntry({
  comment,
  issueId,
  isLast
}: {
  comment: KanbanIssueComment
  issueId: string
  isLast: boolean
}) {
  const deleteComment = useDeleteComment()
  const kind = (comment.authorKind ?? 'user') as 'user' | 'agent' | 'system'

  if (kind === 'system') {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="h-px flex-1 bg-foreground/5" />
        <span className="text-[11px] text-muted-foreground shrink-0 select-none italic">
          {comment.content}
        </span>
        <div className="h-px flex-1 bg-foreground/5" />
      </div>
    )
  }

  const isAgent = kind === 'agent'

  return (
    <div className="flex gap-3 group/entry">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full',
            isAgent ? 'bg-accent/10' : 'bg-foreground/5'
          )}
        >
          {isAgent ? (
            <BotIcon className="size-3 text-accent" />
          ) : (
            <UserIcon className="size-3 text-foreground/60" />
          )}
        </div>
        {!isLast && <div className="w-px flex-1 mt-1.5 mb-1 bg-foreground/5" />}
      </div>

      <div className={cn('min-w-0 flex-1', isLast ? 'pb-0' : 'pb-5')}>
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-[12px] font-medium text-foreground">
            {isAgent ? 'Agent' : 'Me'}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {relativeTime(comment.createdAt)}
          </span>
          <button
            className="text-[11px] text-muted-foreground/50 hover:text-destructive transition-colors opacity-0 group-hover/entry:opacity-100 ml-auto"
            onClick={() => deleteComment.mutate({ id: comment.id, issueId })}
          >
            Delete
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">
          {comment.content}
        </p>
      </div>
    </div>
  )
}

function Activity({ issueId }: { issueId: string }) {
  const { data: comments = [] } = useComments(issueId)

  return (
    <div className="mt-2">
      {comments.map((c: KanbanIssueComment, i: number) => (
        <ActivityEntry
          key={c.id}
          comment={c}
          issueId={issueId}
          isLast={i === comments.length - 1}
        />
      ))}
      <ComposeComment issueId={issueId} />
    </div>
  )
}

// ── Agent Activity Feed ───────────────────────────────────────────────────────

const ACTIVITY_STYLE: Record<string, { icon: typeof BrainIcon; textClass: string }> = {
  thought: { icon: BrainIcon, textClass: 'text-muted-foreground' },
  action: { icon: WrenchIcon, textClass: 'text-foreground/70' },
  response: { icon: MessageSquareIcon, textClass: 'text-foreground' },
  elicitation: { icon: SettingsIcon, textClass: 'text-accent' },
  error: { icon: AlertCircleIcon, textClass: 'text-destructive' },
  prompt: { icon: UserIcon, textClass: 'text-foreground' }
}

function AgentActivityFeed({ agentSessionId }: { agentSessionId: string }) {
  const { data: activities = [] } = useAgentActivities(agentSessionId)
  const [showReasoning, setShowReasoning] = useState(false)

  const reasoning = activities.filter((a) => a.type === 'thought' || a.type === 'action')
  const prominent = activities.filter((a) => a.type !== 'thought' && a.type !== 'action')

  function parseBody(activity: (typeof activities)[number]) {
    try {
      const parsed = JSON.parse(activity.content) as Record<string, unknown>
      if (activity.type === 'action') {
        return `${parsed.action ?? 'action'}(${typeof parsed.parameter === 'string' ? parsed.parameter : '...'})`
      }
      return (parsed.body as string) ?? ''
    } catch {
      return activity.content
    }
  }

  if (activities.length === 0) {
    return <p className="text-[12px] text-muted-foreground">No activity yet.</p>
  }

  return (
    <div className="space-y-3">
      {reasoning.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowReasoning(!showReasoning)}
          >
            <ChevronRightIcon
              className={cn(
                'size-3 transition-transform duration-150',
                showReasoning && 'rotate-90'
              )}
            />
            {reasoning.length} reasoning step
            {reasoning.length !== 1 ? 's' : ''}
          </button>
          <AnimatePresence>
            {showReasoning && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
                className="mt-2 pl-3 border-l border-foreground/10 space-y-2 overflow-hidden"
              >
                {reasoning.map((a) => {
                  const def = ACTIVITY_STYLE[a.type] ?? ACTIVITY_STYLE.thought
                  const Icon = def.icon
                  return (
                    <div
                      key={a.id}
                      className={cn('flex items-start gap-2 text-[12px]', def.textClass)}
                    >
                      <Icon className="mt-0.5 size-3 shrink-0" />
                      <span className="whitespace-pre-wrap min-w-0">{parseBody(a)}</span>
                    </div>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {prominent.map((a) => {
        const def = ACTIVITY_STYLE[a.type] ?? ACTIVITY_STYLE.response
        const Icon = def.icon
        return (
          <div key={a.id} className={cn('flex items-start gap-2 text-[13px]', def.textClass)}>
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap min-w-0 leading-relaxed">{parseBody(a)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── SubIssueList ──────────────────────────────────────────────────────────────

function SubIssueList({
  workspaceId,
  parentIssueId
}: {
  workspaceId: string
  parentIssueId: string
}) {
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId })
  const createIssue = useCreateIssue()
  const [open, setOpen] = useState(true)
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
          setComposing(false)
        }
      }
    )
  }

  const isEmpty = subIssues.length === 0

  return (
    <div>
      <div className="flex items-center gap-2">
        {!isEmpty && (
          <button
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen(!open)}
          >
            <ChevronRightIcon
              className={cn('size-3 transition-transform duration-150', open && 'rotate-90')}
            />
            Sub-issues
            <span className="text-[10px] bg-foreground/5 rounded px-1 py-px tabular-nums text-muted-foreground">
              {subIssues.length}
            </span>
          </button>
        )}
        {isEmpty && (
          <span className="text-[12px] text-muted-foreground select-none">Sub-issues</span>
        )}
        <button
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setComposing(true)}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!isEmpty && open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden mt-1.5 space-y-px"
          >
            {subIssues.map((si: KanbanIssue) => (
              <div
                key={si.id}
                className="flex items-center gap-2 text-[13px] px-2 py-1.5 rounded-lg hover:bg-foreground/3 transition-colors text-foreground cursor-pointer"
              >
                <span className="size-1.5 rounded-full bg-muted-foreground/25 shrink-0" />
                <span className="truncate flex-1">{si.title}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {composing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.12 }}
            className="overflow-hidden mt-2"
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="New sub-issue title…"
              className="w-full text-[13px] bg-foreground/2 border border-foreground/15 rounded-md px-3 py-1.5 outline-none placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-foreground/30 transition-colors"
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

// ── RelationList ──────────────────────────────────────────────────────────────

const RELATION_TYPES = [
  { value: 'relates_to', label: 'Relates to' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'duplicates', label: 'Duplicates' }
] as const

function RelatedIssueTitle({ issueId }: { issueId: string }) {
  const { data: issue } = useIssue(issueId)
  return (
    <span className="text-[12px] truncate flex-1 text-foreground">
      {issue ? issue.title : issueId.substring(0, 8)}
    </span>
  )
}

function RelationList({ issueId, workspaceId }: { issueId: string; workspaceId: string }) {
  const { data: relations = [] } = useRelations(issueId)
  const { data: allIssues = [] } = useIssues({ workspaceId })
  const addRelation = useAddRelation()
  const deleteRelation = useDeleteRelation()
  const [relType, setRelType] = useState<'blocks' | 'duplicates' | 'relates_to'>('relates_to')
  const [showPicker, setShowPicker] = useState(false)

  const relatedIds = new Set(
    relations.flatMap((r: KanbanIssueRelation) => [r.sourceIssueId, r.targetIssueId])
  )
  const candidates = allIssues.filter((i) => i.id !== issueId && !relatedIds.has(i.id))

  function handleSelect(targetId: string | null) {
    if (!targetId) {
      return
    }
    addRelation.mutate(
      { sourceIssueId: issueId, targetIssueId: targetId, type: relType },
      { onSuccess: () => setShowPicker(false) }
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

  return (
    <div className="space-y-1.5">
      {relations.map((r: KanbanIssueRelation) => (
        <div key={r.id} className="flex items-center gap-2 group/rel">
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 h-4 shrink-0 font-normal text-muted-foreground"
          >
            {relationLabel(r)}
          </Badge>
          <RelatedIssueTitle issueId={relatedId(r)} />
          <button
            className="text-muted-foreground/50 hover:text-destructive transition-colors opacity-0 group-hover/rel:opacity-100"
            onClick={() => deleteRelation.mutate({ id: r.id, issueId })}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}

      {showPicker ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
          <div className="flex gap-1 flex-wrap">
            {RELATION_TYPES.map((t) => (
              <button
                key={t.value}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-lg transition-colors',
                  relType === t.value
                    ? 'bg-foreground/5 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
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
              {candidates.map((i) => (
                <ComboboxItem key={i.id} value={i.id}>
                  <span className="truncate">{i.title}</span>
                </ComboboxItem>
              ))}
              {candidates.length === 0 && (
                <div className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                  No issues available
                </div>
              )}
            </ComboboxContent>
          </Combobox>
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowPicker(false)}
          >
            Cancel
          </button>
        </motion.div>
      ) : (
        <button
          className="flex items-center gap-1 text-[12px] text-muted-foreground/50 hover:text-foreground transition-colors"
          onClick={() => setShowPicker(true)}
        >
          <PlusIcon className="size-3" />
          Add relation
        </button>
      )}
    </div>
  )
}

// ── ContextRefList ────────────────────────────────────────────────────────────

function ContextRefList({ issueId, refs }: { issueId: string; refs: ContextRef[] }) {
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
    <div className="space-y-1.5">
      {refs.map((r) => (
        <div key={`${r.type}-${r.value}`} className="flex items-center gap-2 group/ref">
          {r.type === 'url' ? (
            <GlobeIcon className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <FileIcon className="size-3 text-muted-foreground shrink-0" />
          )}
          <Tooltip>
            <TooltipTrigger className="flex-1 min-w-0">
              <span className="text-[12px] text-muted-foreground truncate block">
                {r.label ?? r.value}
              </span>
            </TooltipTrigger>
            <TooltipContent>{r.value}</TooltipContent>
          </Tooltip>
          <button
            className="text-muted-foreground/50 hover:text-destructive transition-colors opacity-0 group-hover/ref:opacity-100"
            onClick={() => removeRef.mutate({ issueId, index: refs.indexOf(r) })}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          placeholder="Add path or URL…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAdd()
            }
          }}
          className="flex-1 text-[12px] bg-transparent outline-none placeholder:text-muted-foreground/50"
        />
        {input.trim() && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleAdd}
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── LabelEditor ───────────────────────────────────────────────────────────────

function LabelEditor({
  labels,
  onAdd,
  onRemove
}: {
  labels: string[]
  onAdd: (l: string) => void
  onRemove: (l: string) => void
}) {
  const [input, setInput] = useState('')

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {labels.map((l) => (
        <Badge
          key={l}
          variant="secondary"
          className="text-[11px] gap-1 px-1.5 h-5 group/label cursor-default"
        >
          {l}
          <button
            className="opacity-0 group-hover/label:opacity-100 transition-opacity"
            onClick={() => onRemove(l)}
          >
            <XIcon className="size-2.5" />
          </button>
        </Badge>
      ))}
      <input
        className="text-[12px] outline-none bg-transparent min-w-14 placeholder:text-muted-foreground/50"
        placeholder="Add…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
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

// ── PropertyRow ───────────────────────────────────────────────────────────────

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center h-8 gap-2">
      <span className="text-[11px] text-muted-foreground w-20 shrink-0 select-none">{label}</span>
      <div className="flex-1 min-w-0 flex justify-start">{children}</div>
    </div>
  )
}

const propertyTriggerCls =
  'h-7 border-0 shadow-none text-[12px] px-2 rounded-md bg-transparent hover:bg-foreground/5 transition-colors'

// ── SectionHeader ─────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-[11px] text-muted-foreground select-none">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] text-muted-foreground bg-foreground/5 rounded px-1 tabular-nums">
          {count}
        </span>
      )}
    </div>
  )
}

// ── Agent Session Status ──────────────────────────────────────────────────────

const SESSION_STATUS_MAP: Record<string, { label: string; dotClass: string; textClass: string }> = {
  created: {
    label: 'Queued',
    dotClass: 'bg-muted-foreground/50',
    textClass: 'text-muted-foreground'
  },
  active: { label: 'Running', dotClass: 'bg-accent animate-pulse', textClass: 'text-accent' },
  completed: { label: 'Done', dotClass: 'bg-success', textClass: 'text-success' },
  stopped: { label: 'Stopped', dotClass: 'bg-info', textClass: 'text-info' },
  failed: { label: 'Failed', dotClass: 'bg-destructive', textClass: 'text-destructive' }
}

function AgentSessionStatus({
  session,
  activeSession,
  onStop,
  onStart
}: {
  session: { id: string; status: string; agentProfileId: string; createdAt: number }
  activeSession: { id: string } | null
  onStop: () => void
  onStart: () => void
}) {
  const { profiles = [] } = useAgentProfiles()
  const agent = profiles.find((p) => p.id === session.agentProfileId)
  const status = SESSION_STATUS_MAP[session.status] ?? SESSION_STATUS_MAP.created

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[8px] p-3 space-y-3',
        'bg-background shadow-minimal'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px]">
          <BotIcon className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{agent?.name ?? 'Agent'}</span>
        </span>
        <span className={cn('flex items-center gap-1.5 text-[11px]', status.textClass)}>
          <span className={cn('size-1.5 rounded-full shrink-0', status.dotClass)} />
          {status.label}
        </span>
      </div>

      {(session.status === 'created' || activeSession) && (
        <div className="flex items-center gap-2">
          {session.status === 'created' && (
            <button
              className="h-6 px-3 rounded-md text-[11px] font-medium bg-accent/10 text-accent hover:bg-accent/15 transition-colors"
              onClick={onStart}
            >
              Start
            </button>
          )}
          {activeSession && (
            <button
              className="flex items-center gap-1 h-6 px-3 rounded-md text-[11px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/15 transition-colors"
              onClick={onStop}
            >
              <CircleStopIcon className="size-3" />
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main IssuePanel ────────────────────────────────────────────────────────────

export function IssuePanel({ issueId, workspaceId }: IssuePanelProps) {
  const { data: issue, isLoading } = useIssue(issueId)
  const { data: agentSessions = [] } = useAgentSessions(issueId)
  const updateIssue = useUpdateIssue()
  const latestSession = agentSessions[0]

  function patch(p: Parameters<typeof updateIssue.mutate>[0]['patch']) {
    if (!issue) {
      return
    }
    updateIssue.mutate({ id: issueId, patch: p })
  }

  if (isLoading || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted-foreground/35">Loading…</span>
      </div>
    )
  }

  return (
    <div data-testid="issue-detail-panel" className="flex h-full flex-1 flex-col overflow-y-auto">
      <div className="max-w-170 w-full mx-auto px-8 pb-20 pt-8 space-y-9">
        <EditableTitle value={issue.title} onSave={(title) => patch({ title })} />

        <MarkdownEditor
          content={issue.description ?? ''}
          onSave={(md) => {
            const trimmed = md.trim() || null
            if (trimmed !== issue.description) {
              patch({ description: trimmed })
            }
          }}
          placeholder="Add a description…"
          className="min-h-24"
        />

        <SubIssueList workspaceId={workspaceId} parentIssueId={issueId} />

        {latestSession && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="size-5 rounded-full flex items-center justify-center bg-accent/10">
                <BotIcon className="size-3 text-accent" />
              </div>
              <span className="text-[12px] text-muted-foreground">Agent reasoning</span>
            </div>
            <AgentActivityFeed agentSessionId={latestSession.id} />
          </div>
        )}

        <div className="h-px bg-foreground/5" />

        <div>
          <span className="text-[12px] text-muted-foreground block mb-3">Activity</span>
          <Activity issueId={issueId} />
        </div>
      </div>
    </div>
  )
}

// ── IssueProperties (AppLayout aside slot) ─────────────────────────────────────

export function IssueProperties({
  issueId,
  workspaceId
}: {
  issueId: string
  workspaceId: string
}) {
  const { data: issue } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { profiles: agentProfiles = [] } = useAgentProfiles()
  const { agents = [] } = useAgents()
  const { data: agentSessions = [] } = useAgentSessions(issueId)
  const { data: relations = [] } = useRelations(issueId)
  const updateIssue = useUpdateIssue()
  const delegateIssue = useDelegateIssue()
  const undelegateIssue = useUndelegateIssue()
  const stopAgentSession = useStopAgentSession()
  const startAgentSession = useStartAgentSession()

  function patch(p: Parameters<typeof updateIssue.mutate>[0]['patch']) {
    if (!issue) {
      return
    }
    updateIssue.mutate({ id: issueId, patch: p })
  }

  function parseLabels(): string[] {
    try {
      return JSON.parse(issue?.labels ?? '[]') as string[]
    } catch {
      return []
    }
  }

  function parseContextRefs(): ContextRef[] {
    try {
      return JSON.parse(issue?.contextRefs ?? '[]') as ContextRef[]
    } catch {
      return []
    }
  }

  if (!issue) {
    return null
  }

  const labels = parseLabels()
  const contextRefs = parseContextRefs()
  const priority = (issue.priority as string) ?? 'none'
  const currentStatus = statuses.find((s) => s.id === issue.statusId)
  const currentMilestone = milestones.find((m) => m.id === issue.milestoneId)
  const currentPriority = PRIORITY_OPTIONS.find((o) => o.value === priority)
  const enabledAgents = agents.filter((a) => a.enabled)
  const enabledProfiles = agentProfiles.filter((p) => p.enabled)
  const currentDelegateAgent = enabledAgents.find((a) => a.providerId === issue.delegateAgentId)
  const currentDelegate =
    currentDelegateAgent ?? enabledProfiles.find((p) => p.id === issue.delegateAgentId)
  const activeSession = agentSessions.find((s) => s.status === 'active' || s.status === 'created')
  const latestSession = agentSessions[0]

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-5 space-y-7">
        <div className="space-y-0.5">
          <PropertyRow label="Status">
            <Select
              value={issue.statusId ?? ''}
              onValueChange={(statusId) => patch({ statusId: statusId || null })}
            >
              <SelectTrigger size="sm" className={propertyTriggerCls}>
                {currentStatus ? (
                  <span className="flex items-center gap-1.5">
                    <StatusIcon color={currentStatus.color} className="size-2.5" />
                    <span>{currentStatus.name}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground/35">None</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  <span className="text-muted-foreground/35">None</span>
                </SelectItem>
                {statuses.map((s) => (
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
              onValueChange={(p) =>
                patch({ priority: p as 'none' | 'low' | 'medium' | 'high' | 'urgent' })
              }
            >
              <SelectTrigger size="sm" className={propertyTriggerCls}>
                <span className="flex items-center gap-1.5">
                  <PriorityIcon priority={priority} className="size-3" />
                  <span>{currentPriority?.label ?? 'No priority'}</span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((o) => (
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
              onValueChange={(milestoneId) => patch({ milestoneId: milestoneId || null })}
            >
              <SelectTrigger size="sm" className={propertyTriggerCls}>
                {currentMilestone ? (
                  <span className="truncate">{currentMilestone.title}</span>
                ) : (
                  <span className="text-muted-foreground/35">None</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  <span className="text-muted-foreground/35">None</span>
                </SelectItem>
                {milestones.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </PropertyRow>

          <PropertyRow label="Assignee">
            <Select
              value={
                issue.delegateAgentId
                  ? `agent:${issue.delegateAgentId}`
                  : issue.assigneeKind === 'user'
                    ? 'user:__self__'
                    : ''
              }
              onValueChange={(val) => {
                if (!val) {
                  undelegateIssue.mutate({ issueId })
                  patch({ assigneeKind: null, assigneeId: null })
                } else if (val === 'user:__self__') {
                  if (issue.delegateAgentId) {
                    undelegateIssue.mutate({ issueId })
                  }
                  patch({ assigneeKind: 'user', assigneeId: '__self__' })
                } else if (val.startsWith('agent:')) {
                  const agentId = val.slice(6)
                  // Resolve Agent identity → Provider ID
                  const agentEntity = enabledAgents.find((a) => a.id === agentId)
                  const profileId = agentEntity ? agentEntity.providerId : agentId
                  patch({ assigneeKind: null, assigneeId: null })
                  delegateIssue.mutate({ issueId, agentProfileId: profileId })
                }
              }}
            >
              <SelectTrigger size="sm" className={propertyTriggerCls}>
                {issue.delegateAgentId ? (
                  <span className="flex items-center gap-1.5">
                    {currentDelegateAgent?.avatarUrl ? (
                      <img
                        src={currentDelegateAgent.avatarUrl}
                        alt=""
                        className="size-3.5 rounded"
                        crossOrigin="anonymous"
                      />
                    ) : (
                      <BotIcon className="size-3" />
                    )}
                    <span>{currentDelegate?.name ?? 'Agent'}</span>
                  </span>
                ) : issue.assigneeKind === 'user' ? (
                  <span className="flex items-center gap-1.5">
                    <UserIcon className="size-3" />
                    <span>Me</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground/35">Unassigned</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  <span className="text-muted-foreground/35">Unassigned</span>
                </SelectItem>
                <SelectItem value="user:__self__">
                  <span className="flex items-center gap-2">
                    <UserIcon className="size-3" />
                    Me
                  </span>
                </SelectItem>
                {enabledAgents.length > 0 && (
                  <div className="px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground select-none">
                    Agents
                  </div>
                )}
                {enabledAgents.map((a) => (
                  <SelectItem key={a.id} value={`agent:${a.id}`}>
                    <span className="flex items-center gap-2">
                      {a.avatarUrl ? (
                        <img
                          src={a.avatarUrl}
                          alt=""
                          className="size-3.5 rounded"
                          crossOrigin="anonymous"
                        />
                      ) : (
                        <BotIcon className="size-3" />
                      )}
                      {a.name}
                    </span>
                  </SelectItem>
                ))}
                {enabledProfiles.length > 0 && enabledAgents.length === 0 && (
                  <div className="px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground select-none">
                    Providers
                  </div>
                )}
                {enabledAgents.length === 0 &&
                  enabledProfiles.map((p) => (
                    <SelectItem key={p.id} value={`agent:${p.id}`}>
                      <span className="flex items-center gap-2">
                        <BotIcon className="size-3" />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </PropertyRow>
        </div>

        {latestSession && (
          <div>
            <SectionHeader label="Agent session" />
            <AgentSessionStatus
              session={latestSession}
              activeSession={activeSession ?? null}
              onStop={() => {
                if (activeSession) {
                  stopAgentSession.mutate({ agentSessionId: activeSession.id, issueId })
                }
              }}
              onStart={() => {
                if (latestSession.status === 'created') {
                  startAgentSession.mutate({
                    issueId,
                    agentSessionId: latestSession.id,
                    agentProfileId: latestSession.agentProfileId
                  })
                }
              }}
            />
          </div>
        )}

        <div>
          <SectionHeader label="Labels" count={labels.length} />
          <LabelEditor
            labels={labels}
            onAdd={(l) => {
              if (!labels.includes(l)) {
                patch({ labels: [...labels, l] })
              }
            }}
            onRemove={(l) => patch({ labels: labels.filter((x) => x !== l) })}
          />
        </div>

        <div>
          <SectionHeader label="Relations" count={relations.length} />
          <RelationList issueId={issueId} workspaceId={workspaceId} />
        </div>

        <div>
          <SectionHeader label="Context" count={contextRefs.length} />
          <ContextRefList issueId={issueId} refs={contextRefs} />
        </div>
      </div>
    </div>
  )
}
