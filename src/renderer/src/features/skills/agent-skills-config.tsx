// Input: skill inventory hooks, workspace list hook, coss UI primitives, AgentSkillConfig value
// Output: AgentSkillsConfig component for choosing inherit vs selected skill references per agent
// Position: Shared form section embedded inside the Agent identity editor

import type { AgentSkillConfig, AgentSkillReference, SkillInventoryEntry } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/cn'
import { BotIcon, FolderTreeIcon, GlobeIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useWorkspaces } from '../workspace'

import { useSkills } from './use-skills'

const SCOPE_LABELS = {
  builtin: 'Built-in',
  global: 'Global',
  workspace: 'Workspace',
} as const

function refKey(ref: AgentSkillReference): string {
  return `${ref.scope}:${ref.name}`
}

function dedupeSkillRefs(refs: AgentSkillReference[]): AgentSkillReference[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = refKey(ref)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function sortInventory(entries: SkillInventoryEntry[]): SkillInventoryEntry[] {
  const order = { builtin: 0, global: 1, workspace: 2 } as const
  return [...entries].sort((left, right) => {
    const scopeDiff = order[left.scope] - order[right.scope]
    if (scopeDiff !== 0) {
      return scopeDiff
    }
    return left.name.localeCompare(right.name)
  })
}

export function AgentSkillsConfig({
  value,
  onChange,
}: {
  value: AgentSkillConfig
  onChange: (nextValue: AgentSkillConfig) => void
}) {
  const { workspaces } = useWorkspaces()
  const [workspaceContextId, setWorkspaceContextId] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceContextId && workspaces[0]) {
      setWorkspaceContextId(workspaces[0].id)
    }
  }, [workspaceContextId, workspaces])

  const { inventory } = useSkills(workspaceContextId)
  const activeEntries = useMemo(() => sortInventory(inventory.filter(entry => entry.active)), [inventory])
  const selectedRefs = value.selected ?? []
  const selectedKeys = new Set(selectedRefs.map(refKey))
  const invalidRefs = selectedRefs.filter(ref => !activeEntries.some(entry => entry.scope === ref.scope && entry.name === ref.name))

  const groupedEntries = useMemo(() => {
    return (['builtin', 'global', 'workspace'] as const).map(scope => ({
      scope,
      entries: activeEntries.filter(entry => entry.scope === scope),
    }))
  }, [activeEntries])

  const setMode = (mode: 'inherit' | 'selected') => {
    onChange({
      mode,
      selected: mode === 'selected' ? dedupeSkillRefs(selectedRefs) : dedupeSkillRefs(selectedRefs),
    })
  }

  const toggleRef = (entry: SkillInventoryEntry) => {
    const ref = { scope: entry.scope, name: entry.name } satisfies AgentSkillReference
    const key = refKey(ref)
    const nextSelected = selectedKeys.has(key)
      ? selectedRefs.filter(current => refKey(current) !== key)
      : [...selectedRefs, ref]

    onChange({
      mode: 'selected',
      selected: dedupeSkillRefs(nextSelected),
    })
  }

  return (
    <div className="grid gap-3" data-testid="agent-skills-config">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] text-muted-foreground">Skills</span>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Inherit all visible skills, or pin this agent to an explicit set of built-in, global, and workspace skills.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <SparklesIcon className="size-3" />
          {value.mode === 'selected' ? 'Selected' : 'Inherit'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-px rounded-md bg-foreground/5 p-px">
        <button
          type="button"
          onClick={() => setMode('inherit')}
          className={cn(
            'rounded-[5px] px-3 py-2 text-left text-[11px] transition-colors',
            value.mode !== 'selected'
              ? 'bg-foreground text-background'
              : 'bg-background text-muted-foreground hover:text-foreground',
          )}
          data-testid="agent-skills-mode-inherit"
        >
          All visible skills
        </button>
        <button
          type="button"
          onClick={() => setMode('selected')}
          className={cn(
            'rounded-[5px] px-3 py-2 text-left text-[11px] transition-colors',
            value.mode === 'selected'
              ? 'bg-foreground text-background'
              : 'bg-background text-muted-foreground hover:text-foreground',
          )}
          data-testid="agent-skills-mode-selected"
        >
          Selected skills only
        </button>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="agent-skill-workspace-context">Workspace context</Label>
        <select
          id="agent-skill-workspace-context"
          value={workspaceContextId ?? ''}
          onChange={event => setWorkspaceContextId(event.target.value || null)}
          className="h-9 rounded-lg border border-input bg-transparent px-3 text-xs outline-none"
        >
          <option value="">No workspace selected</option>
          {workspaces.map(workspace => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </div>

      {value.mode === 'selected' && (
        <div className="grid gap-3 rounded-lg border border-border/60 bg-foreground/2 p-3">
          {groupedEntries.map(group => (
            <div key={group.scope} className="grid gap-2">
              <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                {group.scope === 'builtin' && <BotIcon className="size-3.5" />}
                {group.scope === 'global' && <GlobeIcon className="size-3.5" />}
                {group.scope === 'workspace' && <FolderTreeIcon className="size-3.5" />}
                {SCOPE_LABELS[group.scope]}
              </div>

              {group.entries.length === 0
                ? (
                  <div className="rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground/70">
                    No visible skills in this scope
                  </div>
                )
                : group.entries.map(entry => {
                  const key = `${entry.scope}:${entry.name}`
                  return (
                    <label
                      key={key}
                      className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2"
                    >
                      <Checkbox
                        checked={selectedKeys.has(key)}
                        onCheckedChange={() => toggleRef(entry)}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{entry.name}</div>
                        <div className="text-[11px] text-muted-foreground">{entry.description}</div>
                      </div>
                    </label>
                  )
                })}
            </div>
          ))}

          {invalidRefs.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Missing references:
              {' '}
              {invalidRefs.map(ref => `${ref.scope}:${ref.name}`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
