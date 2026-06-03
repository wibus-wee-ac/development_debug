import type { UpdateAgentInput } from '~/features/agent-runtime/use-agents'
import type { Agent, ProviderTarget } from '~/lib/types'

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
