import { randomUUID } from 'node:crypto'

import {
  conversationBridgeChannelBindings,
  conversationBridgeConnections,
  conversationBridgeDeliveryAttempts,
  conversationBridgeInboundEvents,
  conversationBridgeThreadBindings,
  messages,
  type ConversationBridgeChannelBinding,
  type ConversationBridgeConnection,
  type ConversationBridgeDeliveryAttempt,
  type ConversationBridgeThreadBinding,
} from '@cradle/db'
import type { NormalizedConversationInboundMessage } from '@cradle/plugin-sdk/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { parseJsonObjectOrEmpty } from '../../helpers/json-record'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { listConversationBridgeAdapters } from '../../plugins/conversation-adapter-registry'
import * as ChatRuntime from '../chat-runtime/service'
import { extractMessageText, parseStoredMessageSnapshot } from '../chat-runtime/ui-message'
import type { RuntimeKind } from '../provider-contracts/types'
import * as Session from '../session/service'
import { deliverBridgeMessage } from './runtime-supervisor'

const JsonRecordSchema = z.record(z.string(), z.unknown())

export interface ConversationBridgeAdapterView {
  key: string
  owner: string
  id: string
  platform: string
  label: string
  description: string | null
  capabilities: Record<string, unknown>
  registeredAt: number
}

export interface ConversationBridgeConnectionView extends Omit<ConversationBridgeConnection, 'secretRefsJson' | 'configJson'> {
  secretRefs: Record<string, unknown>
  config: Record<string, unknown>
}

export interface ConversationBridgeChannelBindingView extends Omit<ConversationBridgeChannelBinding, 'metadataJson'> {
  metadata: Record<string, unknown>
}

export interface ConversationBridgeThreadBindingView extends Omit<ConversationBridgeThreadBinding, 'metadataJson'> {
  metadata: Record<string, unknown>
}

export interface ConversationBridgeDeliveryAttemptView extends Omit<ConversationBridgeDeliveryAttempt, 'payloadJson'> {
  payload: Record<string, unknown>
}

export interface CreateConnectionInput {
  platform: string
  adapterOwner: string
  adapterId: string
  displayName: string
  enabled?: boolean
  secretRefs?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface UpdateConnectionInput {
  id: string
  displayName?: string
  enabled?: boolean
  secretRefs?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface BindChannelInput {
  connectionId: string
  externalWorkspaceId: string
  externalChannelId: string
  cradleWorkspaceId: string
  sessionAgentId?: string | null
  sessionProviderTargetId?: string | null
  sessionRuntimeKind?: string | null
  sessionModelId?: string | null
  boundByExternalActorId?: string | null
  metadata?: Record<string, unknown>
}

function now(): number {
  return currentUnixSeconds()
}

function stringifyRecord(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(JsonRecordSchema.parse(value ?? {}))
}

function toConnectionView(row: ConversationBridgeConnection): ConversationBridgeConnectionView {
  const { secretRefsJson, configJson, ...rest } = row
  return {
    ...rest,
    secretRefs: parseJsonObjectOrEmpty(secretRefsJson),
    config: parseJsonObjectOrEmpty(configJson),
  }
}

function toChannelBindingView(row: ConversationBridgeChannelBinding): ConversationBridgeChannelBindingView {
  const { metadataJson, ...rest } = row
  return {
    ...rest,
    metadata: parseJsonObjectOrEmpty(metadataJson),
  }
}

function toThreadBindingView(row: ConversationBridgeThreadBinding): ConversationBridgeThreadBindingView {
  const { metadataJson, ...rest } = row
  return {
    ...rest,
    metadata: parseJsonObjectOrEmpty(metadataJson),
  }
}

function toDeliveryAttemptView(row: ConversationBridgeDeliveryAttempt): ConversationBridgeDeliveryAttemptView {
  const { payloadJson, ...rest } = row
  return {
    ...rest,
    payload: parseJsonObjectOrEmpty(payloadJson),
  }
}

function titleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'External conversation'
  }
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function buildProvenanceText(event: NormalizedConversationInboundMessage): string {
  const actor = event.externalActorId ? `External actor: ${event.externalActorId}\n` : ''
  return `${actor}External channel: ${event.externalChannelId}\nExternal thread: ${event.externalThreadId}\n\n${event.text}`
}

export function listAdapters(): ConversationBridgeAdapterView[] {
  return listConversationBridgeAdapters().map(registered => ({
    key: registered.key,
    owner: registered.owner,
    id: registered.adapter.id,
    platform: registered.adapter.platform,
    label: registered.adapter.label,
    description: registered.adapter.description ?? null,
    capabilities: { ...(registered.adapter.capabilities ?? {}) },
    registeredAt: registered.registeredAt,
  }))
}

export function listConnections(): ConversationBridgeConnectionView[] {
  return db().select().from(conversationBridgeConnections).all().map(toConnectionView)
}

export function getConnection(id: string): ConversationBridgeConnectionView | null {
  const row = db().select().from(conversationBridgeConnections).where(eq(conversationBridgeConnections.id, id)).get()
  return row ? toConnectionView(row) : null
}

export function createConnection(input: CreateConnectionInput): ConversationBridgeConnectionView {
  const timestamp = now()
  const row = db().insert(conversationBridgeConnections).values({
    id: randomUUID(),
    platform: input.platform.trim(),
    adapterOwner: input.adapterOwner.trim(),
    adapterId: input.adapterId.trim(),
    displayName: input.displayName.trim(),
    enabled: input.enabled ?? true,
    secretRefsJson: stringifyRecord(input.secretRefs),
    configJson: stringifyRecord(input.config),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning().get()
  return toConnectionView(row)
}

export function updateConnection(input: UpdateConnectionInput): ConversationBridgeConnectionView | null {
  const existing = db().select().from(conversationBridgeConnections).where(eq(conversationBridgeConnections.id, input.id)).get()
  if (!existing) {
    return null
  }
  const row = db().update(conversationBridgeConnections).set({
    displayName: input.displayName?.trim() ?? existing.displayName,
    enabled: input.enabled ?? existing.enabled,
    secretRefsJson: input.secretRefs === undefined ? existing.secretRefsJson : stringifyRecord(input.secretRefs),
    configJson: input.config === undefined ? existing.configJson : stringifyRecord(input.config),
    updatedAt: now(),
  }).where(eq(conversationBridgeConnections.id, input.id)).returning().get()
  return toConnectionView(row)
}

export function deleteConnection(id: string): void {
  db().delete(conversationBridgeConnections).where(eq(conversationBridgeConnections.id, id)).run()
}

export function bindChannel(input: BindChannelInput): ConversationBridgeChannelBindingView {
  const existing = getChannelBinding(input.connectionId, input.externalWorkspaceId, input.externalChannelId)
  const timestamp = now()
  const id = existing?.id ?? randomUUID()
  db().insert(conversationBridgeChannelBindings).values({
    id,
    connectionId: input.connectionId,
    externalWorkspaceId: input.externalWorkspaceId,
    externalChannelId: input.externalChannelId,
    cradleWorkspaceId: input.cradleWorkspaceId,
    sessionAgentId: input.sessionAgentId ?? null,
    sessionProviderTargetId: input.sessionProviderTargetId ?? null,
    sessionRuntimeKind: input.sessionRuntimeKind ?? null,
    sessionModelId: input.sessionModelId ?? null,
    boundByExternalActorId: input.boundByExternalActorId ?? null,
    metadataJson: stringifyRecord(input.metadata),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: [
      conversationBridgeChannelBindings.connectionId,
      conversationBridgeChannelBindings.externalWorkspaceId,
      conversationBridgeChannelBindings.externalChannelId,
    ],
    set: {
      cradleWorkspaceId: input.cradleWorkspaceId,
      sessionAgentId: input.sessionAgentId ?? null,
      sessionProviderTargetId: input.sessionProviderTargetId ?? null,
      sessionRuntimeKind: input.sessionRuntimeKind ?? null,
      sessionModelId: input.sessionModelId ?? null,
      boundByExternalActorId: input.boundByExternalActorId ?? null,
      metadataJson: stringifyRecord(input.metadata),
      updatedAt: timestamp,
    },
  }).run()
  const row = db().select().from(conversationBridgeChannelBindings).where(eq(conversationBridgeChannelBindings.id, id)).get()
  if (!row) {
    throw new AppError({ code: 'conversation_bridge_binding_failed', status: 500, message: 'Channel binding was not persisted' })
  }
  return toChannelBindingView(row)
}

export function listChannelBindings(connectionId: string): ConversationBridgeChannelBindingView[] {
  return db()
    .select()
    .from(conversationBridgeChannelBindings)
    .where(eq(conversationBridgeChannelBindings.connectionId, connectionId))
    .orderBy(desc(conversationBridgeChannelBindings.updatedAt))
    .all()
    .map(toChannelBindingView)
}

export function getChannelBinding(
  connectionId: string,
  externalWorkspaceId: string,
  externalChannelId: string,
): ConversationBridgeChannelBindingView | null {
  const row = db().select().from(conversationBridgeChannelBindings).where(and(
    eq(conversationBridgeChannelBindings.connectionId, connectionId),
    eq(conversationBridgeChannelBindings.externalWorkspaceId, externalWorkspaceId),
    eq(conversationBridgeChannelBindings.externalChannelId, externalChannelId),
  )).get()
  return row ? toChannelBindingView(row) : null
}

export function unbindChannel(connectionId: string, externalWorkspaceId: string, externalChannelId: string): void {
  db().delete(conversationBridgeChannelBindings).where(and(
    eq(conversationBridgeChannelBindings.connectionId, connectionId),
    eq(conversationBridgeChannelBindings.externalWorkspaceId, externalWorkspaceId),
    eq(conversationBridgeChannelBindings.externalChannelId, externalChannelId),
  )).run()
}

export function listRecentThreadBindings(connectionId: string, limit = 10): ConversationBridgeThreadBindingView[] {
  return db().select().from(conversationBridgeThreadBindings)
    .where(eq(conversationBridgeThreadBindings.connectionId, connectionId))
    .orderBy(desc(conversationBridgeThreadBindings.updatedAt))
    .limit(limit)
    .all()
    .map(toThreadBindingView)
}

function getThreadBinding(event: NormalizedConversationInboundMessage): ConversationBridgeThreadBindingView | null {
  const row = db().select().from(conversationBridgeThreadBindings).where(and(
    eq(conversationBridgeThreadBindings.connectionId, event.connectionId),
    eq(conversationBridgeThreadBindings.externalWorkspaceId, event.externalWorkspaceId),
    eq(conversationBridgeThreadBindings.externalChannelId, event.externalChannelId),
    eq(conversationBridgeThreadBindings.externalThreadId, event.externalThreadId),
  )).get()
  return row ? toThreadBindingView(row) : null
}

function createThreadBinding(
  event: NormalizedConversationInboundMessage,
  sessionId: string,
  cradleWorkspaceId: string | null,
): ConversationBridgeThreadBindingView {
  const timestamp = now()
  const row = db().insert(conversationBridgeThreadBindings).values({
    id: randomUUID(),
    connectionId: event.connectionId,
    externalWorkspaceId: event.externalWorkspaceId,
    externalChannelId: event.externalChannelId,
    externalThreadId: event.externalThreadId,
    sessionId,
    cradleWorkspaceId,
    createdByExternalActorId: event.externalActorId,
    metadataJson: stringifyRecord({ source: 'conversation-bridge' }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning().get()
  return toThreadBindingView(row)
}

function recordInboundEvent(event: NormalizedConversationInboundMessage): 'created' | 'duplicate' {
  const existing = db().select({ id: conversationBridgeInboundEvents.id })
    .from(conversationBridgeInboundEvents)
    .where(and(
      eq(conversationBridgeInboundEvents.connectionId, event.connectionId),
      eq(conversationBridgeInboundEvents.externalEventId, event.externalEventId),
    ))
    .get()
  if (existing) {
    return 'duplicate'
  }
  db().insert(conversationBridgeInboundEvents).values({
    id: randomUUID(),
    connectionId: event.connectionId,
    externalEventId: event.externalEventId,
    externalWorkspaceId: event.externalWorkspaceId,
    externalChannelId: event.externalChannelId,
    externalThreadId: event.externalThreadId,
    externalMessageId: event.externalMessageId,
    eventType: event.eventType,
    status: 'received',
    payloadJson: stringifyRecord(event.payload),
    receivedAt: now(),
  }).run()
  return 'created'
}

function markInboundEvent(
  event: NormalizedConversationInboundMessage,
  status: 'processed' | 'ignored' | 'failed',
  reason: string | null,
): void {
  db().update(conversationBridgeInboundEvents).set({
    status,
    reason,
    processedAt: now(),
  }).where(and(
    eq(conversationBridgeInboundEvents.connectionId, event.connectionId),
    eq(conversationBridgeInboundEvents.externalEventId, event.externalEventId),
  )).run()
}

function readAssistantText(messageId: string): string {
  const row = db().select().from(messages).where(eq(messages.id, messageId)).get()
  if (!row) {
    return ''
  }
  return extractMessageText(parseStoredMessageSnapshot(row.messageJson))
}

async function runSessionTurn(sessionId: string, text: string): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  text: string
}> {
  const response = await ChatRuntime.streamResponse({ sessionId, text })
  const reader = response.stream.getReader()
  void (async () => {
    try {
      while (!(await reader.read()).done) {}
    } finally {
      reader.releaseLock()
    }
  })()
  const run = await ChatRuntime.waitForRunCompletion(response.runId)
  if (run.status === 'failed') {
    throw new AppError({
      code: 'conversation_bridge_run_failed',
      status: 500,
      message: run.errorText ?? 'Conversation bridge chat run failed',
      details: { runId: run.id },
    })
  }
  return {
    runId: response.runId,
    assistantMessageId: response.assistantMessageId,
    userMessageId: response.userMessageId,
    text: readAssistantText(response.assistantMessageId),
  }
}

async function deliverResponse(input: {
  binding: ConversationBridgeThreadBindingView
  text: string
  runId: string
  assistantMessageId: string
}): Promise<void> {
  const timestamp = now()
  const attempt = db().insert(conversationBridgeDeliveryAttempts).values({
    id: randomUUID(),
    connectionId: input.binding.connectionId,
    externalWorkspaceId: input.binding.externalWorkspaceId,
    externalChannelId: input.binding.externalChannelId,
    externalThreadId: input.binding.externalThreadId,
    sessionId: input.binding.sessionId,
    cradleMessageId: input.assistantMessageId,
    runId: input.runId,
    payloadJson: stringifyRecord({ text: input.text }),
    status: 'pending',
    attemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning().get()
  try {
    const delivered = await deliverBridgeMessage({
      connectionId: input.binding.connectionId,
      externalWorkspaceId: input.binding.externalWorkspaceId,
      externalChannelId: input.binding.externalChannelId,
      externalThreadId: input.binding.externalThreadId,
      text: input.text,
      payload: { text: input.text },
    })
    db().update(conversationBridgeDeliveryAttempts).set({
      status: 'delivered',
      attemptCount: attempt.attemptCount + 1,
      externalMessageId: delivered.externalMessageId,
      errorText: null,
      updatedAt: now(),
    }).where(eq(conversationBridgeDeliveryAttempts.id, attempt.id)).run()
  } catch (error) {
    db().update(conversationBridgeDeliveryAttempts).set({
      status: 'failed',
      attemptCount: attempt.attemptCount + 1,
      errorText: error instanceof Error ? error.message : String(error),
      updatedAt: now(),
    }).where(eq(conversationBridgeDeliveryAttempts.id, attempt.id)).run()
    throw error
  }
}

export async function handleInboundMessage(event: NormalizedConversationInboundMessage): Promise<void> {
  if (recordInboundEvent(event) === 'duplicate') {
    return
  }
  try {
    let binding = getThreadBinding(event)
    if (!binding) {
      if (!event.mentionedAdapter) {
        markInboundEvent(event, 'ignored', 'message did not mention the adapter and thread is not bound')
        return
      }
      const channelBinding = getChannelBinding(event.connectionId, event.externalWorkspaceId, event.externalChannelId)
      if (!channelBinding) {
        markInboundEvent(event, 'ignored', 'external channel is not bound to a Cradle workspace')
        return
      }
      if (!channelBinding.sessionAgentId && !channelBinding.sessionProviderTargetId) {
        markInboundEvent(event, 'ignored', 'external channel has no default Cradle runtime target')
        return
      }
      const session = Session.create({
        workspaceId: channelBinding.cradleWorkspaceId,
        title: titleFromText(event.text),
        origin: 'conversation-bridge',
        agentId: channelBinding.sessionAgentId,
        providerTargetId: channelBinding.sessionProviderTargetId,
        runtimeKind: channelBinding.sessionRuntimeKind as RuntimeKind | undefined,
        modelId: channelBinding.sessionModelId,
      })
      binding = createThreadBinding(event, session.id, channelBinding.cradleWorkspaceId)
    }

    const response = await runSessionTurn(binding.sessionId, buildProvenanceText(event))
    await deliverResponse({
      binding,
      text: response.text,
      runId: response.runId,
      assistantMessageId: response.assistantMessageId,
    })
    markInboundEvent(event, 'processed', null)
  } catch (error) {
    markInboundEvent(event, 'failed', error instanceof Error ? error.message : String(error))
    throw error
  }
}

export function listRetryableDeliveryAttempts(limit = 20): ConversationBridgeDeliveryAttemptView[] {
  return db().select().from(conversationBridgeDeliveryAttempts)
    .where(eq(conversationBridgeDeliveryAttempts.status, 'failed'))
    .orderBy(desc(conversationBridgeDeliveryAttempts.updatedAt))
    .limit(limit)
    .all()
    .filter(attempt => attempt.attemptCount < 3)
    .map(toDeliveryAttemptView)
}

export async function retryFailedDeliveries(limit = 20): Promise<{ attempted: number, delivered: number, failed: number }> {
  const attempts = listRetryableDeliveryAttempts(limit)
  let delivered = 0
  let failed = 0
  for (const attempt of attempts) {
    try {
      const result = await deliverBridgeMessage({
        connectionId: attempt.connectionId,
        externalWorkspaceId: attempt.externalWorkspaceId,
        externalChannelId: attempt.externalChannelId,
        externalThreadId: attempt.externalThreadId,
        text: typeof attempt.payload.text === 'string' ? attempt.payload.text : '',
        payload: attempt.payload,
      })
      db().update(conversationBridgeDeliveryAttempts).set({
        status: 'delivered',
        attemptCount: attempt.attemptCount + 1,
        externalMessageId: result.externalMessageId,
        errorText: null,
        updatedAt: now(),
      }).where(eq(conversationBridgeDeliveryAttempts.id, attempt.id)).run()
      delivered += 1
    } catch (error) {
      db().update(conversationBridgeDeliveryAttempts).set({
        status: 'failed',
        attemptCount: attempt.attemptCount + 1,
        errorText: error instanceof Error ? error.message : String(error),
        updatedAt: now(),
      }).where(eq(conversationBridgeDeliveryAttempts.id, attempt.id)).run()
      failed += 1
    }
  }
  return { attempted: attempts.length, delivered, failed }
}

export function updateConnectionHealth(input: {
  connectionId: string
  status: 'starting' | 'running' | 'stopped' | 'error'
  message?: string | null
}): void {
  const timestamp = now()
  db().update(conversationBridgeConnections).set({
    healthStatus: input.status,
    healthMessage: input.message ?? null,
    lastStartedAt: input.status === 'starting' || input.status === 'running' ? timestamp : undefined,
    lastStoppedAt: input.status === 'stopped' ? timestamp : undefined,
    lastErrorAt: input.status === 'error' ? timestamp : undefined,
    updatedAt: timestamp,
  }).where(eq(conversationBridgeConnections.id, input.connectionId)).run()
}
