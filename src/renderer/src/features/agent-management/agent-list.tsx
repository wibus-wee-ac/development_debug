// Input: useAgents hook, useAgentProfiles, AgentDetailPage; Switch, Button, Spinner UI; lucide icons
// Output: AgentList — compact agent card index; clicking a row or "Add" navigates to AgentDetailPage
// Position: Settings section rendered under "Agents" tab

import type { Agent, AgentProfile } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { cn } from '@renderer/lib/cn'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { SettingsDivider, SettingsSectionHeader } from '../settings/settings-row'
import { AgentDetailPage } from './agent-detail'

// ── Constants ─────────────────────────────────────────────────────────────────

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  profiles,
  onNavigate,
  onRemove,
  onToggle,
}: {
  agent: Agent
  profiles: AgentProfile[]
  onNavigate: () => void
  onRemove: () => void
  onToggle: () => void
}) {
  const profile = profiles.find(p => p.id === agent.agentProfileId)
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
  const profileLabel = profile?.name || profile?.providerKind

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={e => e.key === 'Enter' && onNavigate()}
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-foreground/3',
        !agent.enabled && 'opacity-50',
      )}
      data-testid={`agent-row-${agent.id}`}
    >
      {/* Avatar */}
      <div className="size-9 shrink-0 overflow-hidden rounded-xl bg-foreground/3">
        <img
          src={avatarUrl}
          alt={agent.name}
          className="size-full object-cover"
          crossOrigin="anonymous"
          data-testid={`agent-row-avatar-${agent.id}`}
        />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" data-testid={`agent-row-name-${agent.id}`}>{agent.name}</span>
          {profileLabel && (
            <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {profileLabel}
            </span>
          )}
          {agent.modelId && (
            <span className="max-w-32 shrink-0 truncate rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground" data-testid={`agent-row-model-${agent.id}`}>
              {agent.modelId}
            </span>
          )}
        </div>
        {agent.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</p>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label="Remove"
        >
          <Trash2Icon className="size-3" />
        </Button>
      </div>

      <Switch
        checked={agent.enabled}
        onCheckedChange={() => onToggle()}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

type NavigationState
  = | { mode: 'list' }
    | { mode: 'create' }
    | { mode: 'detail', agentId: string }

export function AgentList() {
  const { agents, isLoading, updateAgent, removeAgent } = useAgents()
  const { profiles } = useAgentProfiles()

  const [nav, setNav] = useState<NavigationState>({ mode: 'list' })

  const handleRemove = useCallback(async (id: string) => {
    await removeAgent.mutateAsync(id)
  }, [removeAgent])

  const handleToggle = useCallback(async (agent: Agent) => {
    await updateAgent.mutateAsync({ id: agent.id, patch: { enabled: !agent.enabled } })
  }, [updateAgent])

  const selectedAgent = useMemo(
    () => nav.mode === 'detail' ? agents.find(a => a.id === nav.agentId) : undefined,
    [agents, nav],
  )

  const goList = useCallback(() => setNav({ mode: 'list' }), [])

  // Create or edit mode — show detail page
  if (nav.mode === 'create' || nav.mode === 'detail') {
    return (
      <AgentDetailPage
        agent={selectedAgent}
        profiles={profiles}
        onBack={goList}
        onCreated={id => setNav({ mode: 'detail', agentId: id })}
        onDeleted={goList}
      />
    )
  }

  // List mode
  return (
    <div className="flex flex-col gap-1" data-testid="agent-list">
      <SettingsSectionHeader
        title="Agents"
        description="Create AI agents with unique identities bound to your runtime profiles."
        action={(
          <Button
            size="sm"
            onClick={() => setNav({ mode: 'create' })}
            data-testid="new-agent-btn"
          >
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        )}
      />

      <SettingsDivider />

      {isLoading
        ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : agents.length === 0
          ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-muted-foreground" data-testid="agent-empty-state">
                No agents yet
              </p>
              <p className="text-xs text-muted-foreground">
                Create an agent to give your AI a name, avatar, and preferred model.
              </p>
            </div>
          )
          : (
            <div className="flex flex-col">
              {agents.map(agent => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  profiles={profiles}
                  onNavigate={() => setNav({ mode: 'detail', agentId: agent.id })}
                  onRemove={() => handleRemove(agent.id)}
                  onToggle={() => handleToggle(agent)}
                />
              ))}
            </div>
          )}
    </div>
  )
}
