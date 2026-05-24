// Output: Batch configuration helpers for Settings Agents multi-selection actions.
// Input: Selected agent records and a target provider/model/thinking selection.
// Position: Agent Management owns how settings-level batch edits preserve agent identity fields.

import type { Agent, ProviderTarget, UpdateAgentInput } from '~/lib/types'

export type AgentBatchThinkingEffort = 'low' | 'medium' | 'high' | 'auto'

export interface AgentProviderBatchSelection {
  providerTarget: ProviderTarget
  modelId: string | null
  thinkingEffort: AgentBatchThinkingEffort
}

export interface AgentBatchProviderPatch {
  id: string
  patch: UpdateAgentInput
}

export interface AgentBatchProviderPatchResult {
  patches: AgentBatchProviderPatch[]
  skippedCliTuiCount: number
}

export function buildAgentProviderBatchPatches(
  agents: Agent[],
  selection: AgentProviderBatchSelection,
): AgentBatchProviderPatchResult {
  const patches: AgentBatchProviderPatch[] = []
  let skippedCliTuiCount = 0

  for (const agent of agents) {
    if (agent.runtimeKind === 'cli-tui') {
      skippedCliTuiCount += 1
      continue
    }

    patches.push({
      id: agent.id,
      patch: {
        name: agent.name,
        description: agent.description,
        avatarStyle: agent.avatarStyle,
        avatarSeed: agent.avatarSeed,
        avatarUrl: agent.avatarUrl,
        agentProfileId: selection.providerTarget.kind === 'manual-profile'
          ? selection.providerTarget.id
          : null,
        providerTargetKind: selection.providerTarget.kind,
        providerTargetId: selection.providerTarget.id,
        modelId: selection.modelId,
        thinkingEffort: selection.thinkingEffort,
        runtimeKind: agent.runtimeKind,
        configJson: agent.configJson,
        enabled: agent.enabled,
      },
    })
  }

  return { patches, skippedCliTuiCount }
}
