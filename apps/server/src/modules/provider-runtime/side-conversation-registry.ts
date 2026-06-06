import type { UIMessage } from 'ai'

import type { RuntimeSession } from '../chat-runtime/runtime-provider-types'
import type { RuntimeKind } from '../provider-contracts/types'
import type { ProviderRuntimeLease } from './host-manager'
import { providerRuntimeHostManager } from './host-manager'

export interface SideConversationRecord {
  sideConversationId: string
  parentSessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
  history: UIMessage[]
  expiresAt: number
  pinned: boolean
  lease: ProviderRuntimeLease
}

export interface ReservedSideConversationHostLease {
  sideConversationId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  pinned: true
  lease: ProviderRuntimeLease
}

const DEFAULT_SIDE_CONVERSATION_TTL_MS = 30 * 60 * 1000
const sideConversations = new Map<string, SideConversationRecord>()

function currentTimeMs(): number {
  return Date.now()
}

function pruneExpiredSideConversations(now = currentTimeMs()): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (record.expiresAt <= now || !providerRuntimeHostManager.hasHost(record.lease.hostId)) {
      record.lease.release()
      sideConversations.delete(sideConversationId)
    }
  }
}

export function registerSideConversation(input: Omit<SideConversationRecord, 'expiresAt' | 'lease' | 'pinned' | 'history'> & {
  history?: UIMessage[]
  ttlMs?: number
  hostLease: ReservedSideConversationHostLease
}): SideConversationRecord {
  pruneExpiredSideConversations()
  const ttlMs = input.ttlMs ?? DEFAULT_SIDE_CONVERSATION_TTL_MS
  const hostLease = input.hostLease
  if (
    hostLease.sideConversationId !== input.sideConversationId
    || hostLease.providerTargetId !== input.providerTargetId
    || hostLease.runtimeKind !== input.runtimeKind
    || !hostLease.lease.pinned
  ) {
    hostLease.lease.release()
    throw new Error(`Reserved side conversation host lease does not match side conversation: ${input.sideConversationId}`)
  }
  const existing = sideConversations.get(input.sideConversationId)
  if (existing && existing.lease !== hostLease.lease) {
    existing.lease.release()
  }
  const record: SideConversationRecord = {
    sideConversationId: input.sideConversationId,
    parentSessionId: input.parentSessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId,
    history: input.history ? [...input.history] : [],
    expiresAt: currentTimeMs() + ttlMs,
    pinned: true,
    lease: hostLease.lease,
  }
  sideConversations.set(input.sideConversationId, record)
  return record
}

export function reserveSideConversationHostLease(input: {
  sideConversationId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  ttlMs?: number
}): ReservedSideConversationHostLease {
  pruneExpiredSideConversations()
  const lease = providerRuntimeHostManager.acquireLease({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.sideConversationId,
    ttlMs: input.ttlMs ?? DEFAULT_SIDE_CONVERSATION_TTL_MS,
    pinned: true,
  })
  return {
    sideConversationId: input.sideConversationId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    pinned: true,
    lease,
  }
}

export function readSideConversation(sideConversationId: string): SideConversationRecord | undefined {
  pruneExpiredSideConversations()
  return sideConversations.get(sideConversationId)
}

export function appendSideConversationHistory(sideConversationId: string, messages: UIMessage[]): SideConversationRecord | undefined {
  const record = readSideConversation(sideConversationId)
  if (!record) {
    return undefined
  }
  record.history.push(...messages)
  return record
}

export function refreshSideConversation(sideConversationId: string, ttlMs = DEFAULT_SIDE_CONVERSATION_TTL_MS): SideConversationRecord | undefined {
  const record = readSideConversation(sideConversationId)
  if (!record) {
    return undefined
  }
  record.expiresAt = currentTimeMs() + ttlMs
  record.lease.refresh(ttlMs)
  return record
}

export function releaseSideConversation(sideConversationId: string): void {
  sideConversations.get(sideConversationId)?.lease.release()
  sideConversations.delete(sideConversationId)
}

export function releaseSideConversationsByParentSessionId(parentSessionId: string): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (record.parentSessionId !== parentSessionId) {
      continue
    }
    record.lease.release()
    sideConversations.delete(sideConversationId)
  }
}

export function releaseSideConversationsByProviderTargetId(providerTargetId: string): void {
  for (const [sideConversationId, record] of sideConversations) {
    if (record.providerTargetId !== providerTargetId) {
      continue
    }
    record.lease.release()
    sideConversations.delete(sideConversationId)
  }
}

export function clearSideConversations(): void {
  for (const record of sideConversations.values()) {
    record.lease.release()
  }
  sideConversations.clear()
}
