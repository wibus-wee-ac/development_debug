// Input: useSkills hook, SettingsRow, Dialog
// Output: Settings page for global skills management — flat SettingsRow list
// Position: Settings section for filesystem-backed global skills CRUD

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
import { Textarea } from '@renderer/components/ui/textarea'
import { toastManager } from '@renderer/components/ui/toast'
import { cn } from '@renderer/lib/cn'
import {
  BotIcon,
  FolderTreeIcon,
  GlobeIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useState } from 'react'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '../settings/settings-row'
import { useSkillDocument, useSkills } from './use-skills'

const SCOPE_ICONS: Record<SkillScope, typeof BotIcon> = {
  builtin: BotIcon,
  global: GlobeIcon,
  workspace: FolderTreeIcon,
}

const SCOPE_LABELS: Record<SkillScope, string> = {
  builtin: 'Built-in',
  global: 'Global',
  workspace: 'Workspace',
}

const EMPTY_BODY = '# Overview\n\nDescribe when the agent should use this skill.\n'

function SkillEditDialog({
  open,
  onOpenChange,
  entry,
  workspaceId,
  editableScope,
  onSaved,
  createSkill,
  updateSkill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: SkillInventoryEntry | null
  workspaceId?: string | null
  editableScope: SkillScope
  onSaved: () => void
  createSkill: ReturnType<typeof useSkills>['createSkill']
  updateSkill: ReturnType<typeof useSkills>['updateSkill']
}) {
  const isNew = !entry || entry.name === '__draft__'
  const { document } = useSkillDocument(
    isNew ? null : entry.scope,
    isNew ? null : entry.name,
    workspaceId,
  )

  const [name, setName] = useState(isNew ? '' : entry?.name ?? '')
  const [description, setDescription] = useState(isNew ? '' : (entry?.description ?? ''))
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  // Load body from document when available
  const bodyValue = body || document?.body || (isNew ? EMPTY_BODY : '')

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        await createSkill.mutateAsync({
          scope: editableScope,
          name: name.trim(),
          description: description.trim(),
          body: bodyValue,
        })
      }
      else {
        await updateSkill.mutateAsync({
          scope: entry!.scope,
          name: entry!.name,
          description: description.trim(),
          body: bodyValue,
        })
      }
      onSaved()
      onOpenChange(false)
    }
    catch (err) {
      toastManager.add({
        type: 'error',
        title: isNew ? '创建失败' : '保存失败',
        description: err instanceof Error ? err.message : String(err),
      })
    }
    finally {
      setSaving(false)
    }
  }, [name, description, bodyValue, isNew, editableScope, entry, createSkill, updateSkill, onSaved, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>{isNew ? 'New Skill' : 'Edit Skill'}</DialogTitle>
          <DialogDescription>
            {isNew ? 'Create a new skill document.' : `Editing "${entry?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={!isNew}
              placeholder="my-skill"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this skill provides..."
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Body (Markdown)</Label>
            <Textarea
              value={bodyValue}
              onChange={e => setBody(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder="# Instructions..."
            />
          </div>
        </div>
        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GlobalSkillsSettings() {
  const {
    inventory,
    createSkill,
    updateSkill,
    deleteSkill,
  } = useSkills(null)

  const activeSkills = inventory.filter(s => s.active)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<SkillInventoryEntry | null>(null)

  const handleDelete = useCallback(async (entry: SkillInventoryEntry) => {
    await deleteSkill.mutateAsync({ scope: entry.scope, name: entry.name })
  }, [deleteSkill])

  return (
    <div className="flex flex-col gap-1">
      <SettingsSectionHeader
        title="Skills"
        description="Global skills available to all agents. Built-in skills are bundled with Cradle."
        action={(
          <Button size="sm" onClick={() => {
            setEditingEntry(null)
            setDialogOpen(true)
          }}
          >
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        )}
      />
      <SettingsDivider />

      {activeSkills.length === 0
        ? <p className="py-6 text-center text-[12px] text-muted-foreground">No skills available.</p>
        : (
          <div className="divide-y divide-border/40">
            {activeSkills.map((skill) => {
              const Icon = SCOPE_ICONS[skill.scope]
              const isEditable = skill.scope === 'global'
              return (
                <SettingsRow
                  key={`${skill.scope}:${skill.name}`}
                  label={skill.name}
                  description={skill.description || undefined}
                  className={cn('group', isEditable && 'cursor-pointer')}
                  onClick={isEditable
                    ? () => {
                      setEditingEntry(skill)
                      setDialogOpen(true)
                    }
                    : undefined}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Icon className="size-3" />
                      {SCOPE_LABELS[skill.scope]}
                    </div>
                    {isEditable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(skill)
                        }}
                        className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    )}
                  </div>
                </SettingsRow>
              )
            })}
          </div>
        )}

      <SkillEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editingEntry}
        editableScope="global"
        onSaved={() => { }}
        createSkill={createSkill}
        updateSkill={updateSkill}
      />
    </div>
  )
}
