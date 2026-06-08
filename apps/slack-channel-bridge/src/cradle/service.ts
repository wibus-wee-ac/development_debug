import {
  getAgents,
  getProviderTargets,
  getProvidersTargetsByProviderTargetIdModelsCache,
  getSessionsById,
  getSessionsByIdMessages,
  getWorkspaces,
  postChatSessionsBySessionIdResponse,
  postSessions,
  type GetSessionsByIdResponse,
  type GetSessionsByIdMessagesResponse,
  type GetWorkspacesResponse,
  type GetAgentsResponse,
  type GetProviderTargetsResponse,
  type GetProvidersTargetsByProviderTargetIdModelsCacheResponse,
} from '../generated/cradle-api'
import { collectSseText } from '../slack/sse'

export interface CradleSessionDefaults {
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: string | null
  modelId?: string | null
}

export interface SessionTargetSummary {
  kind: 'agent' | 'provider-target'
  id: string
  label: string
  description: string | null
  runtimeKind: string | null
  providerTargetId: string | null
  modelId: string | null
}

export interface ProviderModelSummary {
  id: string
  label: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  path: string
}

export interface SessionMessageSummary {
  id: string
  role: 'user' | 'assistant'
  status: string
  content: string
}

export interface SessionSummary {
  id: string
  title: string | null
}

export interface SendMessageResult {
  text: string
  runId: string | null
  assistantMessageId: string | null
  userMessageId: string | null
}

export function buildSlackSessionCreateBody(
  input: { workspaceId: string, title: string },
  defaults: CradleSessionDefaults,
) {
  if (defaults.agentId) {
    return {
      workspaceId: input.workspaceId,
      title: input.title,
      agentId: defaults.agentId,
      modelId: defaults.modelId ?? undefined,
    }
  }
  if (!defaults.providerTargetId) {
    throw new Error('Cannot create Slack-backed session: configure CRADLE_SLACK_AGENT_ID or CRADLE_SLACK_PROVIDER_TARGET_ID')
  }
  return {
    workspaceId: input.workspaceId,
    title: input.title,
    providerTargetId: defaults.providerTargetId,
    runtimeKind: defaults.runtimeKind ?? undefined,
    modelId: defaults.modelId ?? undefined,
  }
}

export function enabledAgentTargets(agents: GetAgentsResponse): SessionTargetSummary[] {
  return agents
    .filter(agent => agent.enabled && agent.runtimeKind !== 'cli-tui' && Boolean(agent.providerTargetId))
    .map(agent => ({
      kind: 'agent',
      id: agent.id,
      label: agent.name,
      description: agent.description,
      runtimeKind: agent.runtimeKind,
      providerTargetId: agent.providerTargetId,
      modelId: agent.modelId,
    }))
}

function enabledProviderTargets(targets: GetProviderTargetsResponse): SessionTargetSummary[] {
  return targets
    .filter(target => target.enabled)
    .map(target => ({
      kind: 'provider-target',
      id: target.id,
      label: target.displayName,
      description: target.providerKind,
      runtimeKind: 'standard',
      providerTargetId: target.id,
      modelId: null,
    }))
}

function throwApiError(operation: string, error: unknown): never {
  const detail = typeof error === 'string' ? error : JSON.stringify(error)
  throw new Error(`${operation} failed: ${detail}`)
}

export class CradleService {
  constructor(private readonly defaults: CradleSessionDefaults = {}) {}

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const result = await getWorkspaces()
    if ('error' in result && result.error) {
      throwApiError('listWorkspaces', result.error)
    }
    return ((result.data ?? []) as GetWorkspacesResponse).map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
    }))
  }

  async verifyWorkspace(workspaceId: string): Promise<boolean> {
    const workspaces = await this.listWorkspaces()
    return workspaces.some(workspace => workspace.id === workspaceId)
  }

  async listSessionTargets(): Promise<SessionTargetSummary[]> {
    const [agentsResult, providerTargetsResult] = await Promise.all([
      getAgents(),
      getProviderTargets(),
    ])
    if ('error' in agentsResult && agentsResult.error) {
      throwApiError('listAgents', agentsResult.error)
    }
    if ('error' in providerTargetsResult && providerTargetsResult.error) {
      throwApiError('listProviderTargets', providerTargetsResult.error)
    }
    return [
      ...enabledAgentTargets((agentsResult.data ?? []) as GetAgentsResponse),
      ...enabledProviderTargets((providerTargetsResult.data ?? []) as GetProviderTargetsResponse),
    ]
  }

  async listProviderTargetModels(providerTargetId: string): Promise<ProviderModelSummary[]> {
    const result = await getProvidersTargetsByProviderTargetIdModelsCache({
      path: { providerTargetId },
    })
    if ('error' in result && result.error) {
      throwApiError('listProviderTargetModels', result.error)
    }
    const cache = result.data as GetProvidersTargetsByProviderTargetIdModelsCacheResponse | undefined
    return (cache?.models ?? []).map(model => ({
      id: model.id,
      label: model.label,
    }))
  }

  async createSlackBackedSession(input: {
    workspaceId: string
    title: string
    sessionDefaults?: CradleSessionDefaults
  }): Promise<{ id: string }> {
    const result = await postSessions({
      body: buildSlackSessionCreateBody(input, input.sessionDefaults ?? this.defaults),
    })
    if ('error' in result && result.error) {
      throwApiError('createSlackBackedSession', result.error)
    }
    if (!result.data?.id) {
      throw new Error('createSlackBackedSession failed: missing session id')
    }
    return { id: result.data.id }
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    const result = await getSessionsById({ path: { id: sessionId } })
    if ('error' in result && result.error) {
      return null
    }
    const session = result.data as GetSessionsByIdResponse | undefined
    if (!session?.id) {
      return null
    }
    return {
      id: session.id,
      title: session.title,
    }
  }

  async sendMessageAndCollectResponse(input: {
    sessionId: string
    text: string
  }): Promise<SendMessageResult> {
    const result = await postChatSessionsBySessionIdResponse({
      path: { sessionId: input.sessionId },
      body: { text: input.text },
      sseMaxRetryAttempts: 1,
    })
    const collected = await collectSseText(result.stream)
    return {
      text: collected.text,
      runId: null,
      assistantMessageId: null,
      userMessageId: null,
    }
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessageSummary[]> {
    const result = await getSessionsByIdMessages({ path: { id: sessionId } })
    if ('error' in result && result.error) {
      throwApiError('getSessionMessages', result.error)
    }
    return ((result.data ?? []) as GetSessionsByIdMessagesResponse).map(message => ({
      id: message.id,
      role: message.role,
      status: message.status,
      content: message.content,
    }))
  }
}
