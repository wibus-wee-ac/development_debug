// Input: skill inventory/doc hooks, workspace directory picker IPC, coss UI primitives
// Output: Left-right split skills management UI — list + detail pane, with source-based import
// Position: Shared presentation layer for filesystem skill CRUD, import/export, and layered inventory browsing

import type { SkillInventoryEntry, SkillScope } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import { Textarea } from '@renderer/components/ui/textarea'
import { TruncatedText } from '@renderer/components/ui/truncated-text'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import {
  BotIcon,
  DownloadIcon,
  FolderTreeIcon,
  GlobeIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'

import { SettingsDivider, SettingsSectionHeader } from '../settings/settings-row'
import { SkillImportDialog } from './skill-import-dialog'
import { useSkillDocument, useSkills } from './use-skills'

interface SkillManagerProps {
  workspaceId?: string | null
  agentId?: string | null
  editableScope: 'global' | 'workspace' | 'agent'
  pageTestId: string
  title: string
  description: string
}

interface SelectedSkillRef {
  scope: SkillScope
  name: string
}

const GROUP_ORDER: Record<'global' | 'workspace' | 'agent', SkillScope[]> = {
  global: ['global', 'legacy', 'builtin'],
  workspace: ['workspace', 'global', 'legacy', 'builtin'],
  agent: ['agent', 'global', 'legacy', 'builtin'],
}

const GROUP_LABELS: Record<SkillScope, string> = {
  builtin: 'Built-in',
  legacy: 'Legacy',
  global: 'Global',
  workspace: 'Workspace',
  agent: 'Agent',
}

const SCOPE_ICONS: Record<SkillScope, typeof BotIcon> = {
  builtin: BotIcon,
  legacy: GlobeIcon,
  global: GlobeIcon,
  workspace: FolderTreeIcon,
  agent: BotIcon,
}

const SCOPE_ACCENT: Record<SkillScope, string> = {
  builtin: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  legacy: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  global: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  workspace: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  agent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

const EMPTY_BODY = '# Overview\n\nDescribe when the agent should use this skill.\n'

/* ── Edit Dialog (create / update) ─────────────────────────────────────────── */

function SkillEditDialog({
  open,
  onOpenChange,
  entry,
  workspaceId,
  editableScope,
  agentId,
  onSaved,
  createSkill,
  updateSkill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: SelectedSkillRef | null
  workspaceId?: string | null
  agentId?: string | null
  editableScope: 'global' | 'workspace' | 'agent'
  onSaved: (scope: SkillScope, name: string) => void
  createSkill: ReturnType<typeof useSkills>['createSkill']
  updateSkill: ReturnType<typeof useSkills>['updateSkill']
}) {
  const isDraft = entry?.name === '__draft__'
  const doc = useSkillDocument(
    { workspaceId, agentId },
    isDraft ? null : entry?.scope ?? null,
    isDraft ? null : entry?.name ?? null,
  )

  const [nameVal, setNameVal] = useState('')
  const [descVal, setDescVal] = useState('')
  const [bodyVal, setBodyVal] = useState(EMPTY_BODY)
  const [extraFm, setExtraFm] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null)

  const readOnly = !isDraft && entry != null && entry.scope !== editableScope
  const saving = createSkill.isPending || updateSkill.isPending

  useEffect(() => {
    if (isDraft) {
      setNameVal('')
      setDescVal('')
      setBodyVal(EMPTY_BODY)
      setExtraFm({})
      setError(null)
      return
    }
    if (!doc.data) {
      return
    }
    startTransition(() => {
      const d = doc.data!
      setNameVal(d.name)
      setDescVal(d.description)
      setBodyVal(d.body)
      const { name: _n, description: _d, ...rest } = d.frontmatter
      setExtraFm(rest)
      setError(null)
    })
  }, [doc.data, isDraft])

  const handleSave = async () => {
    try {
      setError(null)
      if (!nameVal.trim()) {
        throw new Error('Name is required')
      }
      if (!descVal.trim()) {
        throw new Error('Description is required')
      }

      const frontmatter = { name: nameVal.trim(), description: descVal.trim(), ...extraFm }

      if (isDraft) {
        const created = await createSkill.mutateAsync({
          scope: editableScope,
          name: nameVal.trim(),
          description: descVal.trim(),
          body: bodyVal,
          frontmatter,
        })
        onSaved(created.scope, created.name)
        onOpenChange(false)
        return
      }

      if (!entry) {
        throw new Error('No skill selected')
      }

      const updated = await updateSkill.mutateAsync({
        scope: entry.scope,
        currentName: entry.name,
        name: nameVal.trim(),
        description: descVal.trim(),
        body: bodyVal,
        frontmatter,
      })
      onSaved(updated.scope, updated.name)
      onOpenChange(false)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>{isDraft ? 'Create Skill' : readOnly ? 'View Skill' : 'Edit Skill'}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'This skill is read-only from the current scope.'
              : isDraft
                ? 'Define a new skill with a name and description.'
                : 'Update the skill metadata and body content.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-name">Name</Label>
            <Input
              id="skill-edit-name"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              readOnly={readOnly}
              placeholder="my-skill"
              className="text-xs"
              data-testid="skill-name-input"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-desc">Description</Label>
            <Input
              id="skill-edit-desc"
              value={descVal}
              onChange={e => setDescVal(e.target.value)}
              readOnly={readOnly}
              placeholder="What does this skill teach the agent?"
              className="text-xs"
              data-testid="skill-desc-input"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-body">Body</Label>
            <Textarea
              id="skill-edit-body"
              value={bodyVal}
              onChange={e => setBodyVal(e.target.value)}
              readOnly={readOnly}
              spellCheck={false}
              rows={8}
              className="min-h-32 font-mono text-xs"
              data-testid="skill-body-editor"
            />
          </div>
          {error && (
            <p className="text-[11px] text-destructive">{error}</p>
          )}
        </div>

        {!readOnly && (
          <DialogFooter variant="bare">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving} data-testid="skill-save-btn">
              {saving && <Spinner className="size-3.5" />}
              {isDraft ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Detail Pane (right side) ──────────────────────────────────────────────── */

function SkillDetail({
  entry,
  workspaceId,
  agentId,
  editableScope,
  onEdit,
  onExport,
  onDelete,
}: {
  entry: SkillInventoryEntry
  workspaceId?: string | null
  agentId?: string | null
  editableScope: 'global' | 'workspace' | 'agent'
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const doc = useSkillDocument({ workspaceId, agentId }, entry.scope, entry.name)
  const isEditable = entry.scope === editableScope
  const Icon = SCOPE_ICONS[entry.scope]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              SCOPE_ACCENT[entry.scope],
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate">{entry.name}</h3>
            <span className="text-[11px] text-muted-foreground">{GROUP_LABELS[entry.scope]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isEditable && (
            <Button variant="ghost" size="icon-xs" onClick={onEdit} className="text-muted-foreground hover:text-foreground" data-testid="skill-edit-btn">
              <PencilIcon />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={onExport} className="text-muted-foreground hover:text-foreground" data-testid="skill-export-btn">
            <DownloadIcon />
          </Button>
          {isEditable && (
            <Button variant="ghost" size="icon-xs" onClick={onDelete} className="text-muted-foreground hover:text-destructive" data-testid="skill-delete-btn">
              <Trash2Icon />
            </Button>
          )}
        </div>
      </div>

      {entry.description && (
        <TruncatedText maxLines={3} className="text-xs text-muted-foreground/60">
          {entry.description}
        </TruncatedText>
      )}

      {doc.data?.body && (
        <div>
          <span className="text-[10px] text-muted-foreground">Content</span>
          <ScrollArea className="mt-1.5 max-h-96">
            <pre className="text-[11px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap font-mono">
              {doc.data.body}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

/* ── Main Component ────────────────────────────────────────────────────────── */

export function SkillManager({
  workspaceId,
  agentId,
  editableScope,
  pageTestId,
  title,
  description,
}: SkillManagerProps) {
  const {
    inventory,
    isLoading,
    createSkill,
    updateSkill,
    deleteSkill,
    exportSkill,
  } = useSkills({ workspaceId, agentId })

  const [selectedSkill, setSelectedSkill] = useState<SelectedSkillRef | null>(null)
  const [editingSkill, setEditingSkill] = useState<SelectedSkillRef | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [scopeFilter, setScopeFilter] = useState<SkillScope | 'all'>('all')
  const [errorText, setErrorText] = useState<string | null>(null)

  const activeInventory = useMemo(() => inventory.filter(entry => entry.active), [inventory])

  const scopes = useMemo(() => GROUP_ORDER[editableScope], [editableScope])

  const filteredInventory = useMemo(() => {
    let entries = activeInventory
    if (scopeFilter !== 'all') {
      entries = entries.filter(e => e.scope === scopeFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      entries = entries.filter(e =>
        e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
    }
    const order = { agent: 0, workspace: 1, global: 2, legacy: 3, builtin: 4 } as const
    return [...entries].sort((a, b) => {
      const aDist = a.scope === editableScope ? -1 : order[a.scope]
      const bDist = b.scope === editableScope ? -1 : order[b.scope]
      if (aDist !== bDist) {
        return aDist - bDist
      }
      return a.name.localeCompare(b.name)
    })
  }, [activeInventory, scopeFilter, searchQuery, editableScope])

  const selectedEntry = useMemo(() => {
    if (!selectedSkill) {
      return null
    }
    return activeInventory.find(e => e.scope === selectedSkill.scope && e.name === selectedSkill.name) ?? null
  }, [activeInventory, selectedSkill])

  const beginDraft = useCallback(() => {
    setEditingSkill({ scope: editableScope, name: '__draft__' })
    setDialogOpen(true)
  }, [editableScope])

  const handleSaved = useCallback((scope: SkillScope, name: string) => {
    setSelectedSkill({ scope, name })
    setEditingSkill(null)
  }, [])

  const handleDelete = useCallback(async () => {
    if (!selectedEntry || selectedEntry.scope !== editableScope) {
      return
    }
    await deleteSkill.mutateAsync({ scope: selectedEntry.scope, name: selectedEntry.name })
    setSelectedSkill(null)
  }, [deleteSkill, editableScope, selectedEntry])

  const handleImport = useCallback(async () => {
    setImportDialogOpen(true)
  }, [])

  const handleExport = useCallback(async () => {
    if (!ipc || !selectedEntry) {
      return
    }
    const destinationDir = await ipc.workspace.selectDirectory()
    if (!destinationDir) {
      return
    }
    try {
      setErrorText(null)
      await exportSkill.mutateAsync({
        scope: selectedEntry.scope,
        name: selectedEntry.name,
        destinationDir,
      })
    }
    catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    }
  }, [exportSkill, selectedEntry])

  return (
    <div className="flex flex-col gap-1" data-testid={pageTestId}>
      {/* Header */}
      <SettingsSectionHeader
        title={title}
        description={description}
        action={(
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void handleImport()} data-testid="skill-import-btn" className="text-muted-foreground hover:text-foreground">
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button size="sm" onClick={beginDraft} data-testid="new-skill-btn">
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        )}
      />

      <SettingsDivider />

      {/* Error */}
      {errorText && (
        <p className="text-[11px] text-destructive">{errorText}</p>
      )}

      {/* Search + filter row */}
      <div className="flex items-center gap-3 py-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-md bg-foreground/4 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
        </div>
        <div className="flex items-center gap-0.5">
          {(['all' as const, ...scopes] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScopeFilter(s)}
              className={cn(
                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                scopeFilter === s
                  ? 'bg-foreground/8 text-foreground'
                  : 'text-muted-foreground/50 hover:text-muted-foreground',
              )}
            >
              {s === 'all' ? 'All' : GROUP_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Skill list */}
      {isLoading
        ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : filteredInventory.length === 0
          ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {searchQuery.trim() ? 'No matching skills' : 'No skills yet'}
            </div>
          )
          : (
            <div className="flex flex-col divide-y divide-foreground/5">
              {filteredInventory.map((entry) => {
                const Icon = SCOPE_ICONS[entry.scope]
                const isEditable = entry.scope === editableScope
                return (
                  <button
                    key={`${entry.scope}:${entry.name}`}
                    type="button"
                    onClick={() => {
                      setSelectedSkill({ scope: entry.scope, name: entry.name })
                      setDetailOpen(true)
                    }}
                    className="group flex items-center gap-3 py-3 text-left transition-colors hover:bg-foreground/3 -mx-2 px-2 rounded-md"
                  >
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-lg',
                        SCOPE_ACCENT[entry.scope],
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-foreground truncate">
                        {entry.name}
                      </span>
                      <TruncatedText maxLines={1} className="text-[11px] text-muted-foreground/60">
                        {entry.description}
                      </TruncatedText>
                    </div>
                    <span className="text-[10px] text-muted-foreground/40">
                      {GROUP_LABELS[entry.scope]}
                    </span>
                    {isEditable && (
                      <Trash2Icon
                        className="opacity-0 size-3.5 shrink-0 text-muted-foreground/40 hover:text-destructive group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation()
                          void deleteSkill.mutateAsync({ scope: entry.scope, name: entry.name })
                        }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle>Skill Detail</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <SkillDetail
              entry={selectedEntry}
              workspaceId={workspaceId}
              editableScope={editableScope}
              agentId={agentId}
              onEdit={() => {
                setDetailOpen(false)
                setEditingSkill(selectedSkill)
                setDialogOpen(true)
              }}
              onExport={() => {
                setDetailOpen(false)
                void handleExport()
              }}
              onDelete={() => {
                setDetailOpen(false)
                void handleDelete()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <SkillImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        editableScope={editableScope}
        workspaceId={workspaceId}
        agentId={agentId}
      />

      {/* Edit Dialog */}
      <SkillEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingSkill}
        workspaceId={workspaceId}
        editableScope={editableScope}
        agentId={agentId}
        onSaved={handleSaved}
        createSkill={createSkill}
        updateSkill={updateSkill}
      />
    </div>
  )
}
