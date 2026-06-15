import { sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../../errors/app-error'
import { db } from '../../../infra'
import { createChildLogger } from '../../../logging/logger'
import { readProviderStateSnapshot } from '../../chat-runtime-providers/provider-state-snapshot'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import {
  assertRuntimeCompatibleTarget,
  attachBinding,
  getSessionRunContext,
  isProviderTargetAvailable,
  readSessionRequestedModelId,
  resolveRuntimeSessionForContext
} from '../runtime-session-context'
import type {
  ProviderNativeAppServerInvokeResponse,
  RuntimeSession
} from '../runtime-provider-types'

const codexHostLogger = createChildLogger({ module: 'chat-runtime.codex-host' })

export interface CodexAppServerInvokeInput {
  sessionId: string
  method: string
  params?: unknown
  providerTargetId?: string
  modelId?: string
}

export interface CodexAppServerStreamInput extends CodexAppServerInvokeInput {
  closeOnMethods?: string[]
}

export async function invokeCodexAppServer(
  input: CodexAppServerInvokeInput
): Promise<ProviderNativeAppServerInvokeResponse> {
  const context = await resolveCodexProviderNativeAppServerContext(input)
  if (!context.runtime.invokeProviderNativeAppServer) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Codex app-server invoke is not available'
    })
  }
  const response = await context.runtime.invokeProviderNativeAppServer({
    ...context,
    method: input.method,
    params: input.params
  })
  persistProviderNativeAppServerRuntimeSession({
    sessionId: input.sessionId,
    runtimeSession: context.runtimeSession,
    providerTargetId: context.runtimeSession.providerTargetId,
    requestedModelId:
      input.modelId ??
      readProviderStateSnapshot(context.runtimeSession.providerStateSnapshot).models.currentModelId
  })
  return response
}

export async function openCodexAppServerStream(
  input: CodexAppServerStreamInput
): Promise<ReadableStream<Uint8Array>> {
  const context = await resolveCodexProviderNativeAppServerContext(input)
  if (!context.runtime.openProviderNativeAppServerStream) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Codex app-server streaming is not available'
    })
  }
  const stream = context.runtime.openProviderNativeAppServerStream({
    ...context,
    method: input.method,
    params: input.params,
    closeOnMethods: input.closeOnMethods
  })
  return persistCodexAppServerRuntimeSessionAfterStream({
    stream,
    sessionId: input.sessionId,
    runtimeSession: context.runtimeSession,
    providerTargetId: context.runtimeSession.providerTargetId,
    modelId: input.modelId
  })
}

function persistProviderNativeAppServerRuntimeSession(input: {
  sessionId: string
  runtimeSession: RuntimeSession
  providerTargetId: string
  requestedModelId: string | null
}): void {
  const session = db()
    .select({ providerTargetId: sessions.providerTargetId })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .get()
  if (
    session?.providerTargetId !== input.providerTargetId ||
    !isProviderTargetAvailable(input.providerTargetId)
  ) {
    codexHostLogger.warn(
      'skipped app-server runtime session persistence after provider target changed',
      {
        sessionId: input.sessionId,
        providerTargetId: input.providerTargetId
      }
    )
    return
  }
  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeSession.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId
  })
}

function persistCodexAppServerRuntimeSessionAfterStream(input: {
  stream: ReadableStream<Uint8Array>
  sessionId: string
  runtimeSession: RuntimeSession
  providerTargetId: string
  modelId?: string
}): ReadableStream<Uint8Array> {
  const reader = input.stream.getReader()
  let persisted = false
  let released = false

  const releaseReader = () => {
    if (released) {
      return
    }
    released = true
    reader.releaseLock()
  }

  const persist = () => {
    if (persisted) {
      return
    }
    persisted = true
    persistProviderNativeAppServerRuntimeSession({
      sessionId: input.sessionId,
      runtimeSession: input.runtimeSession,
      providerTargetId: input.providerTargetId,
      requestedModelId:
        input.modelId ??
        readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot).models.currentModelId
    })
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          persist()
          releaseReader()
          controller.close()
          return
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        persist()
        releaseReader()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        persist()
        releaseReader()
      }
    }
  })
}

async function resolveCodexProviderNativeAppServerContext(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}) {
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  if ((context.session.runtimeKind ?? 'standard') !== 'codex') {
    throw new AppError({
      code: 'chat_runtime_not_codex',
      status: 400,
      message: 'Codex app-server calls require a Codex chat runtime session',
      details: {
        sessionId: input.sessionId,
        runtimeKind: context.session.runtimeKind ?? 'standard'
      }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Runtime is not available: codex'
    })
  }

  const requestedModelId =
    input.modelId ??
    readSessionRequestedModelId({
      session: context.session,
      requestedProviderTargetId: input.providerTargetId
    })
  const { runtimeSession, requestedModelId: resolvedModelId } =
    await resolveRuntimeSessionForContext({
      sessionId: input.sessionId,
      context,
      runtimeKind: 'codex',
      runtime,
      modelId: requestedModelId,
      requestedProviderTargetId: input.providerTargetId
    })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget.id,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId:
      requestedModelId ??
      resolvedModelId ??
      readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId
  })

  return {
    runtime,
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId: requestedModelId ?? resolvedModelId ?? undefined
  }
}
