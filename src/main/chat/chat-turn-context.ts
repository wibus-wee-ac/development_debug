// Input: chat/session/identity tables plus provider-kind rules for prompt assembly
// Output: Minimal turn context resolver for agent name, agent-owned system prompt, and prior chat history
// Position: Chat feature helper that defines the current model-context boundary for one turn

import type { UIMessage } from 'ai'
import { and, eq } from 'drizzle-orm'

import { getDb } from '../db'
import { agents as agentsTable, messages, sessions, workspaces } from '../db/schema'
import type { ProviderKind } from '../agent-runtime/runtime-provider-types'

const ACP_AGENT_ID_PREFIX_RE = /^acp:/

export interface ChatTurnContext {
  agentName: string | null
  systemPrompt: string | undefined
  history: Array<{ role: 'user' | 'assistant', content: string }> | undefined
  workspacePath: string | null
}

export function resolveChatTurnContext(args: {
  chatSessionId: string
  draftMessageId: string
  draftUserMessageId: string
  fallbackAgentId: string
  providerKind: ProviderKind
}): ChatTurnContext {
  const db = getDb()
  const session = db.select().from(sessions).where(eq(sessions.id, args.chatSessionId)).get()
  const workspace = session?.workspaceId
    ? db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    : undefined

  let agentName: string | null = null
  let systemPrompt: string | undefined

  if (session?.agentId) {
    const agent = db.select().from(agentsTable).where(eq(agentsTable.id, session.agentId)).get()
    agentName = agent?.name ?? null
    systemPrompt = readAgentSystemPrompt(agent?.configJson)
  }

  if (args.providerKind === 'acp-chat' && !agentName && args.fallbackAgentId) {
    agentName = args.fallbackAgentId.replace(ACP_AGENT_ID_PREFIX_RE, '')
  }

  const history = args.providerKind === 'acp-chat'
    ? undefined
    : db.select()
      .from(messages)
      .where(and(
        eq(messages.sessionId, args.chatSessionId),
        eq(messages.status, 'complete'),
      ))
      .orderBy(messages.createdAt)
      .all()
      .filter(row => row.id !== args.draftUserMessageId && row.id !== args.draftMessageId)
      .map(row => ({
        role: row.role as 'user' | 'assistant',
        content: extractMessageText(row.content),
      }))

  return {
    agentName,
    systemPrompt,
    history: history && history.length > 0 ? history : undefined,
    workspacePath: workspace?.path ?? null,
  }
}

function readAgentSystemPrompt(configJson: string | null | undefined): string | undefined {
  if (!configJson) {
    return undefined
  }

  try {
    const config = JSON.parse(configJson) as { systemPrompt?: unknown }
    return typeof config.systemPrompt === 'string' && config.systemPrompt.length > 0
      ? config.systemPrompt
      : undefined
  }
  catch {
    return undefined
  }
}

function extractMessageText(content: string): string {
  try {
    const message = JSON.parse(content) as UIMessage
    return message.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => part.type === 'text')
      .map(part => part.text)
      .join('\n')
  }
  catch {
    return content
  }
}
