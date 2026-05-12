// Input: agentId + sessionId from transitional ACP-aware callers
// Output: useAcpSessionState hook with empty state during Agent Runtime migration
// Position: Transitional data hook retained until provider-level model state is wired into chat sessions

export interface AcpSessionState {
  models: {
    currentModelId: string
    availableModels: Array<{ modelId: string, name: string }>
  } | null
  configOptions: Array<{
    id: string
    name: string
    category?: string
    type: string
    currentValue?: string | boolean
    options?: Array<{ value: string, name: string }>
  }>
}

const EMPTY_CONFIG_OPTIONS: AcpSessionState['configOptions'] = []

export function acpSessionStateQueryKey(agentId: string | null, sessionId: string | null) {
  return ['acp-session-state', agentId, sessionId] as const
}

export async function getAcpSessionState(
  _agentId?: string,
  _sessionId?: string,
): Promise<AcpSessionState | null> {
  return null
}

export async function setAcpSessionModel(
  _agentId?: string,
  _sessionId?: string,
  _modelId?: string,
): Promise<void> {}

export async function setAcpSessionConfigOption(
  _agentId?: string,
  _sessionId?: string,
  _configId?: string,
  _value?: string | boolean,
): Promise<void> {}

export function useAcpSessionState(_agentId: string | null, _sessionId: string | null): {
  state: AcpSessionState | null
  models: AcpSessionState['models']
  configOptions: AcpSessionState['configOptions']
  setModel: (modelId: string) => void
  setConfigOption: (input: { configId: string, value: string | boolean }) => void
} {
  return {
    state: null,
    models: null,
    configOptions: EMPTY_CONFIG_OPTIONS,
    setModel: () => {},
    setConfigOption: () => {},
  }
}
