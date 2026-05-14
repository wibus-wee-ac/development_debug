// Input: useAgentProfiles, useAgents, useSkills, AgentRuntimeSettings dialogs
// Output: AiSettings — unified AI settings page (Providers + Agents + Skills) in SettingsRow pattern
// Position: Settings feature section — single page for all AI config (Linear-style)

import {
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { deleteProfilesById, getProfiles, getSkills, putProfilesById } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Switch } from '~/components/ui/switch'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { cn } from '~/lib/cn'
import type { Agent, AgentProfile, SkillInventoryEntry } from '~/lib/types'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

// ── Provider Kind metadata ────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  'openai-compatible': 'OpenAI',
  'acp-chat': 'ACP',
  'cli-tui': 'CLI',
}

// ── Provider Row ──────────────────────────────────────────────────────────────

function ProviderRow({
  profile,
  onToggle,
  onEdit,
  onRemove,
}: {
  profile: AgentProfile
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(profile.configJson ?? '{}')
    }
    catch {
      return {}
    }
  }, [profile.configJson])

  const model = profile.providerKind === 'openai-compatible' ? parsed.model : null
  const subtitle = [
    KIND_LABELS[profile.providerKind] ?? profile.providerKind,
    model,
  ].filter(Boolean).join(' · ')

  return (
    <SettingsRow
      label={profile.name}
      description={subtitle}
      className="group"
      onClick={onEdit}
    >
      <div className="flex items-center gap-3" role="group" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Switch
          size="sm"
          checked={profile.enabled}
          onCheckedChange={onToggle}
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </SettingsRow>
  )
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  profiles,
  onToggle,
  onEdit,
  onRemove,
}: {
  agent: Agent
  profiles: AgentProfile[]
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const profile = profiles.find(p => p.id === agent.agentProfileId)
  const subtitle = [
    profile?.name,
    agent.modelId,
  ].filter(Boolean).join(' · ')

  return (
    <SettingsRow
      label={agent.name}
      description={subtitle || agent.description || undefined}
      className={cn('group', !agent.enabled && 'opacity-50')}
      onClick={onEdit}
    >
      <div className="flex items-center gap-3" role="group" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <Switch
          size="sm"
          checked={agent.enabled}
          onCheckedChange={onToggle}
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </SettingsRow>
  )
}

// ── Skill Row ─────────────────────────────────────────────────────────────────

function SkillRow({ skill }: { skill: SkillInventoryEntry }) {
  return (
    <SettingsRow
      label={skill.name}
      description={skill.description || undefined}
    >
      <span className="text-[10px] text-muted-foreground capitalize">{skill.scope}</span>
    </SettingsRow>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AiSettings() {
  // Providers
  const [profiles, setProfiles] = useState<AgentProfile[]>([])

  const refreshProfiles = useCallback(async () => {
    const { data } = await getProfiles()
    setProfiles((data ?? []) as AgentProfile[])
  }, [])

  useEffect(() => {
    refreshProfiles().catch(() => setProfiles([]))
  }, [refreshProfiles])

  const handleToggleProfile = useCallback(async (id: string, enabled: boolean) => {
    const profile = profiles.find(p => p.id === id)
    if (!profile) {
      return
    }
    await putProfilesById({
      path: { id },
      body: {
        name: profile.name,
        providerKind: profile.providerKind,
        enabled,
        config: JSON.parse(profile.configJson || '{}'),
        credentialRef: profile.credentialRef ?? undefined,
      },
    })
    await refreshProfiles()
  }, [profiles, refreshProfiles])

  const handleRemoveProfile = useCallback(async (id: string) => {
    await deleteProfilesById({ path: { id } })
    await refreshProfiles()
  }, [refreshProfiles])

  // Agents
  const { agents, isLoading: agentsLoading, updateAgent, removeAgent } = useAgents()
  const { profiles: agentProfiles } = useAgentProfiles()

  const handleToggleAgent = useCallback(async (agent: Agent) => {
    await updateAgent.mutateAsync({ id: agent.id, patch: { enabled: !agent.enabled } })
  }, [updateAgent])

  const handleRemoveAgent = useCallback(async (id: string) => {
    await removeAgent.mutateAsync(id)
  }, [removeAgent])

  // Skills
  const [skills, setSkills] = useState<SkillInventoryEntry[]>([])

  useEffect(() => {
    getSkills()
      .then(({ data }) => setSkills(((data ?? []) as SkillInventoryEntry[]).filter(s => s.active)))
      .catch(() => setSkills([]))
  }, [])

  return (
    <div className="flex flex-col gap-10">
      {/* ── Providers ── */}
      <section>
        <SettingsSectionHeader
          title="Providers"
          description="AI provider connections for generating responses."
          action={(
            <Button size="sm">
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          )}
        />
        <SettingsDivider />
        {profiles.length === 0
          ? <p className="py-6 text-center text-[12px] text-muted-foreground">No providers configured.</p>
          : (
            <div className="divide-y divide-border/40">
              {profiles.map(p => (
                <ProviderRow
                  key={p.id}
                  profile={p}
                  onToggle={enabled => void handleToggleProfile(p.id, enabled)}
                  onEdit={() => { }}
                  onRemove={() => void handleRemoveProfile(p.id)}
                />
              ))}
            </div>
          )}
      </section>

      {/* ── Agents ── */}
      <section>
        <SettingsSectionHeader
          title="Agents"
          description="AI identities with configured models and behaviors."
          action={(
            <Button size="sm">
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          )}
        />
        <SettingsDivider />
        {agentsLoading
          ? <p className="py-6 text-center text-[12px] text-muted-foreground">Loading…</p>
          : agents.length === 0
            ? <p className="py-6 text-center text-[12px] text-muted-foreground">No agents configured.</p>
            : (
              <div className="divide-y divide-border/40">
                {agents.map(agent => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    profiles={agentProfiles}
                    onToggle={() => void handleToggleAgent(agent)}
                    onEdit={() => { }}
                    onRemove={() => void handleRemoveAgent(agent.id)}
                  />
                ))}
              </div>
            )}
      </section>

      {/* ── Skills ── */}
      <section>
        <SettingsSectionHeader
          title="Skills"
          description="Knowledge modules available to all agents."
          action={(
            <Button size="sm">
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          )}
        />
        <SettingsDivider />
        {skills.length === 0
          ? <p className="py-6 text-center text-[12px] text-muted-foreground">No skills available.</p>
          : (
            <div className="divide-y divide-border/40">
              {skills.map(s => (
                <SkillRow key={`${s.scope}:${s.name}`} skill={s} />
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
