// Input: useAgentProfiles hook
// Output: useCliAgents hook — lists CLI-TUI profiles from unified Agent Runtime
// Position: Transitional data hook for CLI agent selection in the Composer

import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'

export const CLI_AGENTS_QUERY_KEY = ['agent-profiles'] as const

export function useCliAgents() {
  const { profiles } = useAgentProfiles()
  return { agents: profiles.filter(profile => profile.providerKind === 'cli-tui' && profile.enabled) }
}
