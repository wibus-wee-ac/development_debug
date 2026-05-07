// Input: Provider catalog, backend control-plane bindings, workspace/session rows, and chat turn executor
// Output: Thin chat engine shell for session lifecycle orchestration and provider session continuity
// Position: Chat feature coordinator consumed by IPC adapters and higher-level workflows

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getProviderCatalog } from '../agent-runtime/catalog-instance'
import type { ChatRuntimeProvider, ProviderKind, RuntimeSession as ProviderSession } from '../agent-runtime/runtime-provider-types'
import { getBackendControlPlaneService } from '../backend-control-plane/backend-control-plane'
import { getDb } from '../db'
import type { AgentProfile, Session } from '../db/schema'
import { agentProfiles as agentProfilesTable, sessions, workspaces } from '../db/schema'
import type { DomainEventBus } from '../events/domain-event-bus'
import type { ObservabilitySink } from '../observability/sink'
import { noopObservabilitySink } from '../observability/sink'
import { createChatTurnExecutor } from './chat-turn-executor'

export interface CreateAndSendOpts {
  agentId: string
  workspaceId: string
  cwd: string
  text: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  agentIdentityId?: string
}

export interface EnsureLiveResult {
  liveAcpSessionId: string
  continuity: 'active' | 'resumed' | 'reset'
}

export interface ChatEngine {
  bindObservability: (sink: ObservabilitySink) => void
  bindEventBus: (bus: DomainEventBus) => void
  initialize: () => void
  destroy: () => void
  createAndSend: (opts: CreateAndSendOpts) => Promise<string>
  send: (chatSessionId: string, text: string) => Promise<void>
  hasDraft: (chatSessionId: string) => boolean
  abort: (chatSessionId: string) => Promise<void>
  ensureLive: (chatSessionId: string) => Promise<EnsureLiveResult>
}

export function createChatEngine(options?: { observability?: ObservabilitySink }): ChatEngine {
  let observability = options?.observability ?? noopObservabilitySink
  let eventBus: DomainEventBus | null = null
  let initialized = false

  const turnExecutor = createChatTurnExecutor({
    loadProfile,
    getChatProvider,
    getEventBus: () => eventBus,
    getObservability: () => observability,
  })

  function bindObservability(sink: ObservabilitySink): void {
    observability = sink
  }

  function bindEventBus(bus: DomainEventBus): void {
    eventBus = bus
  }

  function initialize(): void {
    if (initialized) {
      return
    }
    initialized = true
    turnExecutor.recoverStrandedRuns()
  }

  function destroy(): void {
    turnExecutor.destroy()
    observability = noopObservabilitySink
    eventBus = null
    initialized = false
  }

  async function createAndSend(opts: CreateAndSendOpts): Promise<string> {
    const chatSessionId = randomUUID()
    const { agentId, workspaceId, cwd, text, modelId: requestedModelId, thinkingEffort } = opts

    const profile = loadProfile(agentId)
    const provider = getChatProvider(profile.providerKind)
    const runtimeSession = await provider.startChatSession({
      chatSessionId,
      profile,
      workspacePath: cwd,
      modelId: requestedModelId,
    })

    const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text
    const { modelId } = extractSessionMeta(runtimeSession.providerStateSnapshot)
    const bindingModelId = requestedModelId ?? modelId
    const providerOptions = thinkingEffort ? { thinkingEffort } : undefined

    const draft = turnExecutor.prepareTurn({
      chatSessionId,
      agentId,
      agentIdentityId: opts.agentIdentityId,
      runtimeSession,
      userText: text,
      modelId: requestedModelId,
      providerOptions,
      newSession: {
        workspaceId,
        title: fallbackTitle,
      },
    })

    const controlPlane = getBackendControlPlaneService()
    controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: runtimeSession.providerKind,
      backendSessionId: runtimeSession.providerSessionId,
      backendStateSnapshot: runtimeSession.providerStateSnapshot,
      requestedModelId: bindingModelId,
    })
    draft.runId = controlPlane.startRun({
      chatSessionId,
      messageId: draft.messageId,
      origin: 'user',
    }).id
    recordSessionCapabilitySnapshot(profile.id, profile.providerKind, runtimeSession.providerStateSnapshot)

    void turnExecutor.executeTurn(draft, text).catch((error) => {
      console.error('[ChatEngine] executeTurn failed (createAndSend):', error)
    })

    return chatSessionId
  }

  async function send(chatSessionId: string, text: string): Promise<void> {
    if (turnExecutor.hasDraft(chatSessionId)) {
      throw new Error(`Chat session ${chatSessionId} already has a turn in progress`)
    }

    const session = getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    const profile = loadProfile(session.agentProfileId)
    const provider = getChatProvider(profile.providerKind)
    const controlPlane = getBackendControlPlaneService()
    const binding = controlPlane.getBinding(chatSessionId)

    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .get()
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available')
    }

    const storedSession: ProviderSession = {
      id: session.id,
      chatSessionId: session.id,
      agentProfileId: session.agentProfileId,
      providerKind: binding?.providerKind ?? profile.providerKind,
      providerSessionId: binding?.backendSessionId ?? null,
      providerStateSnapshot: binding?.backendStateSnapshot ?? null,
    }

    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: cwd,
    })
    const resumedMeta = extractSessionMeta(runtimeSession.providerStateSnapshot)

    controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: runtimeSession.providerKind,
      backendSessionId: runtimeSession.providerSessionId,
      backendStateSnapshot: runtimeSession.providerStateSnapshot,
      requestedModelId: binding?.requestedModelId ?? resumedMeta.modelId,
    })
    recordSessionCapabilitySnapshot(profile.id, profile.providerKind, runtimeSession.providerStateSnapshot)

    const draft = turnExecutor.prepareTurn({
      chatSessionId,
      agentId: session.agentProfileId,
      runtimeSession,
      userText: text,
      modelId: binding?.requestedModelId ?? resumedMeta.modelId ?? undefined,
    })
    draft.runId = controlPlane.startRun({
      chatSessionId,
      messageId: draft.messageId,
      origin: 'user',
    }).id

    void turnExecutor.executeTurn(draft, text).catch((error) => {
      console.error('[ChatEngine] executeTurn failed (send):', error)
    })
  }

  async function abort(chatSessionId: string): Promise<void> {
    await turnExecutor.abort(chatSessionId)
  }

  async function ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    const session = getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    const controlPlane = getBackendControlPlaneService()
    const binding = controlPlane.getBinding(chatSessionId)
    if (binding?.backendSessionId) {
      return { liveAcpSessionId: binding.backendSessionId, continuity: 'active' }
    }

    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .get()
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available for session reconnect.')
    }

    const profile = loadProfile(session.agentProfileId)
    const provider = getChatProvider(profile.providerKind)
    const storedSession: ProviderSession = {
      id: session.id,
      chatSessionId: session.id,
      agentProfileId: session.agentProfileId,
      providerKind: binding?.providerKind ?? profile.providerKind,
      providerSessionId: null,
      providerStateSnapshot: binding?.backendStateSnapshot ?? null,
    }

    const resumed = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: cwd,
    })
    const resumedMeta = extractSessionMeta(resumed.providerStateSnapshot)
    const updatedBinding = controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: resumed.providerKind,
      backendSessionId: resumed.providerSessionId,
      backendStateSnapshot: resumed.providerStateSnapshot,
      requestedModelId: binding?.requestedModelId ?? resumedMeta.modelId,
    })
    recordSessionCapabilitySnapshot(profile.id, profile.providerKind, resumed.providerStateSnapshot)

    return {
      liveAcpSessionId: updatedBinding.backendSessionId ?? chatSessionId,
      continuity: 'reset',
    }
  }

  return {
    bindObservability,
    bindEventBus,
    initialize,
    destroy,
    createAndSend,
    send,
    hasDraft: turnExecutor.hasDraft,
    abort,
    ensureLive,
  }
}

function loadProfile(agentId: string): AgentProfile {
  const profile = getDb().select().from(agentProfilesTable).where(eq(agentProfilesTable.id, agentId)).get()
  if (!profile || !profile.enabled) {
    throw new Error(`Agent profile not found or not enabled: ${agentId}`)
  }
  return profile
}

function getChatProvider(providerKind: string): ChatRuntimeProvider {
  const catalog = getProviderCatalog()
  const provider = catalog.get(providerKind as ProviderKind)
  if (!('startChatSession' in provider)) {
    throw new Error(`Provider ${providerKind} does not support chat sessions`)
  }
  return provider as ChatRuntimeProvider
}

function getSessionRow(chatSessionId: string): Session | undefined {
  return getDb().select().from(sessions).where(eq(sessions.id, chatSessionId)).get()
}

function recordSessionCapabilitySnapshot(
  agentProfileId: string,
  providerKind: ProviderKind,
  providerStateSnapshot: string | null,
): void {
  if (!providerStateSnapshot) {
    return
  }
  getBackendControlPlaneService().recordCapabilitySnapshot({
    agentProfileId,
    providerKind,
    source: 'session_start',
    capabilitiesJson: providerStateSnapshot,
  })
}

function extractSessionMeta(providerStateSnapshot: string | null): {
  modelId: string | null
} {
  if (!providerStateSnapshot) {
    return { modelId: null }
  }

  try {
    const state = JSON.parse(providerStateSnapshot) as {
      models?: { currentModelId?: string }
    }
    return {
      modelId: typeof state?.models?.currentModelId === 'string'
        ? state.models.currentModelId
        : null,
    }
  }
  catch {
    return { modelId: null }
  }
}

export const chatEngine = createChatEngine()
