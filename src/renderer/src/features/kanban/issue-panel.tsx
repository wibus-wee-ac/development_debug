// Input: KanbanIssue id, use-kanban hooks, Select/Textarea/Badge UI components
// Output: IssuePanel component — sliding right-side panel for viewing and editing an issue
// Position: Feature component used in KanbanBoardView as the detail overlay

import type { KanbanIssueRelation } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { cn } from '@renderer/lib/cn'
import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  useAddComment,
  useAddRelation,
  useComments,
  useDeleteComment,
  useDeleteRelation,
  useIssue,
  useIssues,
  useMilestones,
  useRelations,
  useStatuses,
  useUpdateIssue,
} from './use-kanban'

// ── Types ─────────────────────────────────────────────────────────────────────

interface IssuePanelProps {
  issueId: string
  workspaceId: string
  onClose: () => void
}

// ── Priority helpers ──────────────────────────────────────────────────────────

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'No priority' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const PRIORITY_BADGE: Record<string, string> = {
  none: 'bg-muted text-muted-foreground',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const RELATION_OPTIONS = [
  { value: 'blocks', label: 'Blocks' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'relates_to', label: 'Relates to' },
]

// ── Sub-component: EditableTitle ──────────────────────────────────────────────

function EditableTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (next: string) => void
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
    }
  }, [editing])

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    }
    else {
      setDraft(value)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      commit()
    }
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full text-xl font-semibold bg-transparent border-b border-ring outline-none pb-0.5"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    )
  }

  return (
    <h2
      className="text-xl font-semibold cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => setEditing(true)}
    >
      {value}
    </h2>
  )
}

// ── Sub-component: LabelEditor ────────────────────────────────────────────────

function LabelEditor({
  labels,
  onAdd,
  onRemove,
}: {
  labels: string[]
  onAdd: (label: string) => void
  onRemove: (label: string) => void
}) {
  const [input, setInput] = useState('')

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      onAdd(input.trim())
      setInput('')
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {labels.map(l => (
        <Badge
          key={l}
          variant="secondary"
          className="cursor-pointer gap-1"
          onClick={() => onRemove(l)}
        >
          {l}
          <span className="opacity-60 hover:opacity-100 text-xs">×</span>
        </Badge>
      ))}
      <input
        className="text-sm outline-none bg-transparent min-w-20 placeholder:text-muted-foreground"
        placeholder="Add label…"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

// ── Sub-component: CommentList ────────────────────────────────────────────────

function CommentList({ issueId }: { issueId: string }) {
  const { data: comments = [] } = useComments(issueId)
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const [draft, setDraft] = useState('')

  function handleAdd() {
    const content = draft.trim()
    if (!content) {
      return
    }
    addComment.mutate({ issueId, content }, { onSuccess: () => setDraft('') })
  }

  return (
    <div className="space-y-3">
      {comments.map(c => (
        <div key={c.id} className="rounded-lg border bg-muted/30 p-3 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{new Date(c.createdAt).toLocaleString()}</span>
            <button
              className="hover:text-destructive transition-colors"
              onClick={() => deleteComment.mutate({ id: c.id, issueId })}
            >
              ×
            </button>
          </div>
          <p className="text-sm whitespace-pre-wrap">{c.content}</p>
        </div>
      ))}

      <div className="space-y-2">
        <Textarea
          placeholder="Add a comment…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          size="sm"
        />
        <button
          className={cn(
            'text-sm px-3 py-1 rounded-md bg-primary text-primary-foreground',
            'hover:bg-primary/90 transition-colors disabled:opacity-50',
          )}
          disabled={!draft.trim() || addComment.isPending}
          onClick={handleAdd}
        >
          Comment
        </button>
      </div>
    </div>
  )
}

// ── Sub-component: RelationList ───────────────────────────────────────────────

function RelationList({ issueId }: { issueId: string }) {
  const { data: relations = [] } = useRelations(issueId)
  const addRelation = useAddRelation()
  const deleteRelation = useDeleteRelation()
  const [targetId, setTargetId] = useState('')
  const [relType, setRelType] = useState<'blocks' | 'duplicates' | 'relates_to'>('relates_to')

  function handleAdd() {
    const t = targetId.trim()
    if (!t) {
      return
    }
    addRelation.mutate(
      { sourceIssueId: issueId, targetIssueId: t, type: relType },
      { onSuccess: () => setTargetId('') },
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

  function otherIssueId(r: KanbanIssueRelation) {
    return r.sourceIssueId === issueId ? r.targetIssueId : r.sourceIssueId
  }

  return (
    <div className="space-y-2">
      {relations.map(r => (
        <div key={r.id} className="flex items-center justify-between text-sm gap-2">
          <span className="text-muted-foreground capitalize">{relationLabel(r)}</span>
          <span className="font-mono text-xs truncate flex-1">{otherIssueId(r)}</span>
          <button
            className="text-muted-foreground hover:text-destructive transition-colors text-xs"
            onClick={() => deleteRelation.mutate({ id: r.id, issueId })}
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex gap-2 items-center pt-1">
        <Select
          value={relType}
          onValueChange={v => setRelType(v as typeof relType)}
        >
          <SelectTrigger className="min-w-27.5" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {RELATION_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <input
          className="flex-1 text-xs px-2 h-8 rounded-md border border-input bg-background outline-none focus:ring-2 ring-ring/24"
          placeholder="Issue ID…"
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          className="text-xs px-2 h-8 rounded-md bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          disabled={!targetId.trim() || addRelation.isPending}
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ── Sub-component: SubIssueList ───────────────────────────────────────────────

function SubIssueList({
  workspaceId,
  parentIssueId,
  onSelectIssue,
}: {
  workspaceId: string
  parentIssueId: string
  onSelectIssue: (id: string) => void
}) {
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId })

  if (subIssues.length === 0) {
    return <p className="text-xs text-muted-foreground">No sub-issues</p>
  }

  return (
    <div className="space-y-1">
      {subIssues.map(si => (
        <button
          key={si.id}
          className="w-full text-left text-sm px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors truncate"
          onClick={() => onSelectIssue(si.id)}
        >
          {si.title}
        </button>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function IssuePanel({ issueId, workspaceId, onClose }: IssuePanelProps) {
  const { data: issue, isLoading } = useIssue(issueId)
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const updateIssue = useUpdateIssue()

  // local description draft for auto-save-on-blur
  const [descDraft, setDescDraft] = useState<string | null>(null)

  useEffect(() => {
    if (!issue) {
      return
    }
    setDescDraft(issue.description ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId])

  function patch(p: Parameters<typeof updateIssue.mutate>[0]['patch']) {
    if (!issue) {
      return
    }
    updateIssue.mutate({ id: issueId, patch: p })
  }

  function saveDescription() {
    if (descDraft === null || !issue) {
      return
    }
    const trimmed = descDraft.trim() || null
    if (trimmed !== (issue.description ?? null)) {
      patch({ description: trimmed })
    }
  }

  function parseLabels(): string[] {
    if (!issue) {
      return []
    }
    try {
      return JSON.parse(issue.labels) as string[]
    }
    catch {
      return []
    }
  }

  const labels = parseLabels()

  function addLabel(l: string) {
    if (labels.includes(l)) {
      return
    }
    patch({ labels: [...labels, l] })
  }

  function removeLabel(l: string) {
    patch({ labels: labels.filter(x => x !== l) })
  }

  // Track stack for sub-issue navigation
  const [issueStack, setIssueStack] = useState<string[]>([issueId])
  const currentId = issueStack.at(-1) ?? issueId

  // When issueId prop changes externally reset stack
  useEffect(() => {
    setIssueStack([issueId])
  }, [issueId])

  function openSubIssue(id: string) {
    setIssueStack(prev => [...prev, id])
  }

  function goBack() {
    setIssueStack(prev => prev.slice(0, -1))
  }

  // When navigated inside panel, use a nested panel for sub-issues
  if (currentId !== issueId) {
    return <IssuePanel issueId={currentId} workspaceId={workspaceId} onClose={goBack} />
  }

  if (isLoading || !issue) {
    return (
      <aside className="flex h-full w-105 border-l bg-background z-40 items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading…</span>
      </aside>
    )
  }

  const currentStatus = statuses.find(s => s.id === issue.statusId)
  const currentMilestone = milestones.find(m => m.id === issue.milestoneId)
  const priority = (issue.priority as string) ?? 'none'

  return (
    <aside className="flex h-full w-120 border-l bg-background z-40 flex-col overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {issueStack.length > 1 && (
            <button
              className="text-muted-foreground hover:text-foreground transition-colors text-sm"
              onClick={goBack}
            >
              ←
            </button>
          )}
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {issue.id.substring(0, 8)}
          </span>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Title */}
        <EditableTitle
          value={issue.title}
          onSave={title => patch({ title })}
        />

        {/* Metadata row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Status</label>
            <Select
              value={issue.statusId ?? ''}
              onValueChange={statusId => patch({ statusId: statusId || null })}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="No status" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">
                  <span className="text-muted-foreground">No status</span>
                </SelectItem>
                {statuses.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      {s.color && (
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: s.color }}
                        />
                      )}
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Priority</label>
            <Select
              value={priority}
              onValueChange={p => patch({ priority: p as 'none' | 'low' | 'medium' | 'high' | 'urgent' })}
            >
              <SelectTrigger size="sm">
                <SelectValue>
                  <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.none)}>
                    {PRIORITY_OPTIONS.find(o => o.value === priority)?.label ?? 'None'}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {PRIORITY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          {/* Milestone */}
          <div className="space-y-1 col-span-2">
            <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Milestone</label>
            <Select
              value={issue.milestoneId ?? ''}
              onValueChange={milestoneId => patch({ milestoneId: milestoneId || null })}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="No milestone" />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">
                  <span className="text-muted-foreground">No milestone</span>
                </SelectItem>
                {milestones.map(m => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.title}
                    {m.dueDate && (
                      <span className="text-xs text-muted-foreground ml-2">
                        {'due '}
                        {new Date(m.dueDate).toLocaleDateString()}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {currentMilestone && (
              <p className="text-xs text-muted-foreground">
                {currentStatus?.name ?? 'Backlog'}
                {' · '}
                {currentMilestone.title}
              </p>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Description</label>
          <Textarea
            placeholder="Add a description…"
            value={descDraft ?? ''}
            onChange={e => setDescDraft(e.target.value)}
            onBlur={saveDescription}
            size="default"
          />
        </div>

        {/* Labels */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Labels</label>
          <LabelEditor labels={labels} onAdd={addLabel} onRemove={removeLabel} />
        </div>

        {/* Sub-issues */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Sub-issues</label>
          <SubIssueList
            workspaceId={workspaceId}
            parentIssueId={issueId}
            onSelectIssue={openSubIssue}
          />
        </div>

        {/* Relations */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Relations</label>
          <RelationList issueId={issueId} />
        </div>

        {/* Comments */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Comments</label>
          <CommentList issueId={issueId} />
        </div>
      </div>
    </aside>
  )
}
