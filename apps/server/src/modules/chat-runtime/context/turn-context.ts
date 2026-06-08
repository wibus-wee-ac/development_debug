import type { Session } from '@cradle/db'
import { agents, messages, sessions } from '@cradle/db'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { readTrustedAgentRuntimeConfig } from '../../../helpers/agent-runtime-config'
import { getSystemWorkflow } from '../../../helpers/system-workflow'
import { db } from '../../../infra'
import { createChildLogger } from '../../../logging/logger'
import { buildAgentMemoryContext } from '../../chronicle/agent-context'
import type { CradleTurnTranscript } from '../transcript'
import { resolveCradleTurnTranscript } from '../transcript'

const chatTurnContextLogger = createChildLogger({ module: 'chat-runtime.turn-context' })
const DEFAULT_TURN_CONTEXT_MAX_MESSAGES = 12
const DEFAULT_TURN_CONTEXT_MAX_CHARS = 120_000

export interface ChatTurnContext {
  systemPrompt?: string
  transcript?: CradleTurnTranscript
  history?: UIMessage[]
}

export function resolveSessionSystemPrompt(session: Session | null | undefined): string | undefined {
  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = readTrustedAgentRuntimeConfig(agent?.configJson).systemPrompt
  }

  const workflow = getSystemWorkflow()
  if (workflow) {
    systemPrompt = systemPrompt ? `${workflow}\n\n---\n\n${systemPrompt}` : workflow
  }

  return systemPrompt
}

export function resolveTurnContext(input: {
  sessionId: string
  draftMessageId: string
  draftUserMessageId: string
}): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  let systemPrompt = resolveSessionSystemPrompt(session)
  const draftUserMessage = db()
    .select()
    .from(messages)
    .where(eq(messages.id, input.draftUserMessageId))
    .get()
  const chronicleContext = draftUserMessage?.content
    ? resolveChronicleTurnContext(draftUserMessage.content)
    : null
  if (chronicleContext) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${chronicleContext}` : chronicleContext
  }
  const transcript = resolveBoundedTurnHistory({
    sessionId: input.sessionId,
    excludedMessageIds: new Set([input.draftMessageId, input.draftUserMessageId])
  })

  return {
    systemPrompt,
    transcript,
    history: transcript.history.length > 0 ? transcript.history : undefined
  }
}

function resolveBoundedTurnHistory(input: {
  sessionId: string
  excludedMessageIds: Set<string>
}): CradleTurnTranscript {
  return resolveCradleTurnTranscript({
    sessionId: input.sessionId,
    excludedMessageIds: input.excludedMessageIds,
    maxMessages: readPositiveIntegerEnv(
      'CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES',
      DEFAULT_TURN_CONTEXT_MAX_MESSAGES
    ),
    maxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS',
      DEFAULT_TURN_CONTEXT_MAX_CHARS
    )
  })
}

function resolveChronicleTurnContext(query: string): string | null {
  try {
    return buildAgentMemoryContext({
      query,
      memoryLimit: 3,
      knowledgeLimit: 3,
      maxChars: 6_000
    })
  } catch (error) {
    chatTurnContextLogger.warn('failed to resolve Chronicle turn context', {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) {
    return fallback
  }
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
