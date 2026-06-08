import {
  getSessionsById,
  getSessionsByIdMessages,
  getWorkspaces,
  postChatSessionsBySessionIdResponse,
  postSessions,
  type GetSessionsByIdResponse,
  type GetSessionsByIdMessagesResponse,
  type GetWorkspacesResponse,
} from '../generated/cradle-api'
import { collectSseText } from '../slack/sse'

export interface CradleSessionDefaults {
  agentId?: string | null
  providerTargetId?: string | null
  runtimeKind?: string | null
  modelId?: string | null
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

  async createSlackBackedSession(input: {
    workspaceId: string
    title: string
  }): Promise<{ id: string }> {
    const result = await postSessions({
      body: buildSlackSessionCreateBody(input, this.defaults),
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
