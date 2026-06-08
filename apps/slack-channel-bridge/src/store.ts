import { randomUUID } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import type { BridgeDatabase } from './db/client'
import {
  deliveryAttempts,
  inboundEvents,
  slackInstallations,
  threadBindings,
  workspaceBindings,
  type DeliveryAttempt,
  type ThreadBinding,
  type WorkspaceBinding,
} from './db/schema'

export interface SetWorkspaceBindingInput {
  teamId: string
  channelId: string
  cradleWorkspaceId: string
  boundBySlackUserId: string
}

export interface ThreadBindingInput {
  teamId: string
  channelId: string
  threadTs: string
  cradleSessionId: string
  cradleWorkspaceId: string | null
  createdBySlackUserId: string | null
}

export interface InboundEventInput {
  eventId: string
  teamId: string | null
  channelId: string | null
  threadTs: string | null
  slackTs: string | null
  eventType: string
}

export interface DeliveryAttemptInput {
  teamId: string
  channelId: string
  threadTs: string
  cradleSessionId: string
  cradleMessageId?: string | null
  runId?: string | null
  messageText?: string | null
  messageBlocksJson?: string | null
}

export class BridgeStore {
  constructor(private readonly database: BridgeDatabase) {}

  close(): void {
    this.database.close()
  }

  async upsertInstallation(input: {
    teamId: string
    enterpriseId?: string | null
    botUserId?: string | null
  }): Promise<void> {
    const now = Date.now()
    this.database.db
      .insert(slackInstallations)
      .values({
        teamId: input.teamId,
        enterpriseId: input.enterpriseId ?? null,
        botUserId: input.botUserId ?? null,
        installedAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: slackInstallations.teamId,
        set: {
          enterpriseId: input.enterpriseId ?? null,
          botUserId: input.botUserId ?? null,
          revokedAt: null,
        },
      })
      .run()
  }

  async getWorkspaceBinding(teamId: string, channelId: string): Promise<WorkspaceBinding | null> {
    return this.database.db.select().from(workspaceBindings).where(and(
      eq(workspaceBindings.teamId, teamId),
      eq(workspaceBindings.channelId, channelId),
    )).get() ?? null
  }

  async setWorkspaceBinding(input: SetWorkspaceBindingInput): Promise<WorkspaceBinding> {
    const existing = await this.getWorkspaceBinding(input.teamId, input.channelId)
    const now = Date.now()
    const id = existing?.id ?? randomUUID()
    this.database.db
      .insert(workspaceBindings)
      .values({
        id,
        teamId: input.teamId,
        channelId: input.channelId,
        cradleWorkspaceId: input.cradleWorkspaceId,
        boundBySlackUserId: input.boundBySlackUserId,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [workspaceBindings.teamId, workspaceBindings.channelId],
        set: {
          cradleWorkspaceId: input.cradleWorkspaceId,
          boundBySlackUserId: input.boundBySlackUserId,
          updatedAt: now,
        },
      })
      .run()
    return (await this.getWorkspaceBinding(input.teamId, input.channelId))!
  }

  async removeWorkspaceBinding(teamId: string, channelId: string): Promise<void> {
    this.database.db.delete(workspaceBindings).where(and(
      eq(workspaceBindings.teamId, teamId),
      eq(workspaceBindings.channelId, channelId),
    )).run()
  }

  async getThreadBinding(input: {
    teamId: string
    channelId: string
    threadTs: string
  }): Promise<ThreadBinding | null> {
    return this.database.db.select().from(threadBindings).where(and(
      eq(threadBindings.teamId, input.teamId),
      eq(threadBindings.channelId, input.channelId),
      eq(threadBindings.threadTs, input.threadTs),
    )).get() ?? null
  }

  async createThreadBinding(input: ThreadBindingInput): Promise<ThreadBinding> {
    const existing = await this.getThreadBinding(input)
    if (existing) {
      return existing
    }
    const now = Date.now()
    const id = randomUUID()
    this.database.db.insert(threadBindings).values({
      id,
      teamId: input.teamId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      cradleSessionId: input.cradleSessionId,
      cradleWorkspaceId: input.cradleWorkspaceId,
      createdBySlackUserId: input.createdBySlackUserId,
      createdAt: now,
      updatedAt: now,
    }).run()
    return (await this.getThreadBinding(input))!
  }

  async listRecentThreadBindings(teamId: string, channelId: string, limit = 5): Promise<ThreadBinding[]> {
    return this.database.db.select().from(threadBindings).where(and(
      eq(threadBindings.teamId, teamId),
      eq(threadBindings.channelId, channelId),
    )).orderBy(desc(threadBindings.updatedAt)).limit(limit).all()
  }

  async recordInboundEvent(input: InboundEventInput): Promise<'created' | 'duplicate'> {
    const existing = this.database.db.select({ eventId: inboundEvents.eventId }).from(inboundEvents)
      .where(eq(inboundEvents.eventId, input.eventId))
      .get()
    if (existing) {
      return 'duplicate'
    }
    this.database.db.insert(inboundEvents).values({
      ...input,
      status: 'received',
      reason: null,
      receivedAt: Date.now(),
      processedAt: null,
    }).run()
    return 'created'
  }

  async markInboundEventProcessed(eventId: string): Promise<void> {
    this.database.db.update(inboundEvents).set({
      status: 'processed',
      processedAt: Date.now(),
      reason: null,
    }).where(eq(inboundEvents.eventId, eventId)).run()
  }

  async markInboundEventIgnored(eventId: string, reason: string): Promise<void> {
    this.database.db.update(inboundEvents).set({
      status: 'ignored',
      processedAt: Date.now(),
      reason,
    }).where(eq(inboundEvents.eventId, eventId)).run()
  }

  async markInboundEventFailed(eventId: string, reason: string): Promise<void> {
    this.database.db.update(inboundEvents).set({
      status: 'failed',
      processedAt: Date.now(),
      reason,
    }).where(eq(inboundEvents.eventId, eventId)).run()
  }

  async createDeliveryAttempt(input: DeliveryAttemptInput): Promise<DeliveryAttempt> {
    const now = Date.now()
    const id = randomUUID()
    this.database.db.insert(deliveryAttempts).values({
      id,
      teamId: input.teamId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      cradleSessionId: input.cradleSessionId,
      cradleMessageId: input.cradleMessageId ?? null,
      runId: input.runId ?? null,
      messageText: input.messageText ?? null,
      messageBlocksJson: input.messageBlocksJson ?? null,
      status: 'pending',
      attemptCount: 0,
      slackTs: null,
      errorText: null,
      createdAt: now,
      updatedAt: now,
    }).run()
    return this.database.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.id, id)).get()!
  }

  async markDeliveryAttemptDelivered(id: string, slackTs: string): Promise<void> {
    const current = this.database.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.id, id)).get()
    this.database.db.update(deliveryAttempts).set({
      status: 'delivered',
      attemptCount: (current?.attemptCount ?? 0) + 1,
      slackTs,
      errorText: null,
      updatedAt: Date.now(),
    }).where(eq(deliveryAttempts.id, id)).run()
  }

  async markDeliveryAttemptFailed(id: string, errorText: string): Promise<void> {
    const current = this.database.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.id, id)).get()
    this.database.db.update(deliveryAttempts).set({
      status: 'failed',
      attemptCount: (current?.attemptCount ?? 0) + 1,
      errorText,
      updatedAt: Date.now(),
    }).where(eq(deliveryAttempts.id, id)).run()
  }

  async listRetryableDeliveryAttempts(limit = 20): Promise<DeliveryAttempt[]> {
    return this.database.db.select().from(deliveryAttempts)
      .where(eq(deliveryAttempts.status, 'failed'))
      .orderBy(desc(deliveryAttempts.updatedAt))
      .limit(limit)
      .all()
      .filter(attempt => attempt.messageText && attempt.attemptCount < 3)
  }
}
