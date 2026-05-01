// Input: skill inventory hooks, workspace list hook, coss UI primitives, AgentSkillConfig value
// Output: AgentSkillsConfig component — clean skill picker for per-agent configuration
// Position: Shared form section embedded inside the Agent identity editor

import type { AgentSkillConfig, AgentSkillReference, SkillInventoryEntry } from '@main/ipc-types'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { cn } from '@renderer/lib/cn'
import { BotIcon, ChevronDownIcon, FolderTreeIcon, GlobeIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { useWorkspaces } from '../workspace'
import { useSkills } from './use-skills'

const SCOPE_LABELS = {
  builtin: 'Built-in',
  global: 'Global',
  workspace: 'Workspace',
} as const

const SCOPE_ICONS: Record<string, typeof BotIcon> = {
  builtin: BotIcon,
  global: GlobeIcon,
  workspace: FolderTreeIcon,
}

const SCOPE_COLORS: Record<string, string> = {
  builtin: 'text-violet-500',
  global: 'text-sky-500',
  workspace: 'text-emerald-500',
}

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
      selected: dedupeSkillRefs(selectedRefs),
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

  const isSelectedMode = value.mode === 'selected'
  const selectedCount = selectedRefs.length
  const totalCount = activeEntries.length

  return (
    <div className="grid gap-2.5" data-testid="agent-skills-config">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Skills</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {isSelectedMode ? `${selectedCount} / ${totalCount}` : `${totalCount} available`}
        </span>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg bg-foreground/3 p-0.5">
        {(['inherit', 'selected'] as const).map((mode) => {
          const isActive = (value.mode ?? 'inherit') === mode || (mode === 'inherit' && !isSelectedMode)
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              className={cn(
                'flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`agent-skills-mode-${mode}`}
            >
              {mode === 'inherit' ? 'All skills' : 'Selected only'}
            </button>
          )
        })}
      </div>

      {/* Workspace selector */}
      <div className="relative">
        <select
          value={workspaceContextId ?? ''}
          onChange={event => setWorkspaceContextId(event.target.value || null)}
          className={cn(
            'w-full appearance-none rounded-md bg-foreground/3 px-2.5 py-1.5 pr-7 text-[11px] outline-none',
            'text-muted-foreground/60 transition-colors',
            'focus:bg-foreground/5',
          )}
        >
          <option value="">No workspace</option>
          {workspaces.map(workspace => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
      </div>

      {/* Skill list — only in selected mode */}
      {isSelectedMode && (
        <div className="grid gap-2 pt-0.5">
          {groupedEntries.map((group) => {
            if (group.entries.length === 0) {
              return null
            }
            const Icon = SCOPE_ICONS[group.scope]
            const color = SCOPE_COLORS[group.scope]
            return (
              <div key={group.scope} className="grid gap-1">
                <div className={cn('flex items-center gap-1.5 text-[10px] font-medium', color)}>
                  <Icon className="size-3" />
                  <span className="text-muted-foreground">{SCOPE_LABELS[group.scope]}</span>
                </div>
                {group.entries.map((entry) => {
                  const key = `${entry.scope}:${entry.name}`
                  const checked = selectedKeys.has(key)
                  return (
                    <label
                      key={key}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors',
                        checked
                          ? 'bg-foreground/5'
                          : 'hover:bg-foreground/3',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleRef(entry)}
                        className="size-3.5"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-[11px] font-medium text-foreground">{entry.name}</span>
                        {entry.description && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground truncate">
                            {entry.description}
                          </span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
            )
          })}

          {/* Invalid refs warning */}
          {invalidRefs.length > 0 && (
            <p className="text-[10px] text-amber-500/60 px-1">
              {invalidRefs.length}
              {' '}
              selected skill
              {invalidRefs.length > 1 ? 's' : ''}
              {' '}
              not found in current workspace
            </p>
          )}
        </div>
      )}
    </div>
  )
}
