// Input: request runtime context headers and session persistence
// Output: server-owned actor context for mutation provenance
// Position: apps/server/src/http shared runtime identity resolver

import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../errors/app-error'
import { db } from '../infra'

export const CRADLE_CHAT_SESSION_ID_HEADER = 'x-cradle-chat-session-id'

export type MutationActorKind = 'user' | 'agent' | 'system'

export interface MutationActor {
  kind: MutationActorKind
  id: string
  source: 'default-user' | 'chat-session'
}

const DEFAULT_USER_ACTOR: MutationActor = {
  kind: 'user',
  id: '__self__',
  source: 'default-user',
}

export function resolveActorContext(request: Request): MutationActor {
  const chatSessionId = request.headers.get(CRADLE_CHAT_SESSION_ID_HEADER)?.trim()
  if (!chatSessionId) {
    return DEFAULT_USER_ACTOR
  }

  const session = db()
    .select({ id: sessions.id, agentId: sessions.agentId, agentProfileId: sessions.agentProfileId })
    .from(sessions)
    .where(eq(sessions.id, chatSessionId))
    .get()

  if (!session) {
    throw new AppError({
      code: 'runtime_context_not_found',
      status: 401,
      message: 'Runtime context not found',
      details: { chatSessionId },
    })
  }

  if (session.agentId) {
    return {
      kind: 'agent',
      id: session.agentId,
      source: 'chat-session',
    }
  }

  if (session.agentProfileId) {
    throw new AppError({
      code: 'runtime_agent_identity_missing',
      status: 409,
      message: 'Runtime session is missing agent identity',
      details: { chatSessionId, agentProfileId: session.agentProfileId },
    })
  }

  return {
    kind: 'user',
    id: '__self__',
    source: 'chat-session',
  }
}
