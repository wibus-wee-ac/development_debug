// Input: useAgentProfiles hook
// Output: useInstalledAcpAgents compatibility hook backed by unified Agent Runtime profiles
// Position: Transitional data hook for older composer imports during Agent Runtime migration

import { useAgentProfiles } from './use-agent-profiles'

export const ACP_AGENTS_QUERY_KEY = ['agent-profiles'] as const

export function useInstalledAcpAgents() {
  const { profiles } = useAgentProfiles()
  return { agents: profiles.filter(profile => profile.providerKind === 'acp-chat' && profile.enabled) }
}
