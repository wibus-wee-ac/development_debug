import type { RuntimeKind } from '../provider-contracts/types'
import type { RuntimeSession } from '../chat-runtime/runtime-provider-types'
import type { ProviderRuntimeLease } from './host-manager'
import { providerRuntimeHostManager } from './host-manager'

export interface SideConversationRecord {
  sessionId: string
  parentSessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
  expiresAt: number
  pinned: boolean
  lease: ProviderRuntimeLease
}

const DEFAULT_SIDE_CONVERSATION_TTL_MS = 30 * 60 * 1000
const sideConversations = new Map<string, SideConversationRecord>()

function currentTimeMs(): number {
  return Date.now()
}

function pruneExpiredSideConversations(now = currentTimeMs()): void {
  for (const [sessionId, record] of sideConversations) {
    if (record.expiresAt <= now || !providerRuntimeHostManager.hasHost(record.lease.hostId)) {
      record.lease.release()
      sideConversations.delete(sessionId)
    }
  }
}

export function registerSideConversation(input: Omit<SideConversationRecord, 'expiresAt' | 'lease' | 'pinned'> & {
  ttlMs?: number
  pinned?: boolean
}): SideConversationRecord {
  pruneExpiredSideConversations()
  const ttlMs = input.ttlMs ?? DEFAULT_SIDE_CONVERSATION_TTL_MS
  const existing = sideConversations.get(input.sessionId)
  existing?.lease.release()
  const lease = providerRuntimeHostManager.acquireLease({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.sessionId,
    ttlMs,
    pinned: input.pinned ?? true,
  })
  const record: SideConversationRecord = {
    sessionId: input.sessionId,
    parentSessionId: input.parentSessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId,
    expiresAt: currentTimeMs() + ttlMs,
    pinned: input.pinned ?? true,
    lease,
  }
  sideConversations.set(input.sessionId, record)
  return record
}

export function reserveSideConversationHost(input: {
  sessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  ttlMs?: number
  pinned?: boolean
}): ProviderRuntimeLease {
  pruneExpiredSideConversations()
  return providerRuntimeHostManager.acquireLease({
    runtimeKind: input.runtimeKind,
    providerTargetId: input.providerTargetId,
    scopeId: input.sessionId,
    ttlMs: input.ttlMs ?? DEFAULT_SIDE_CONVERSATION_TTL_MS,
    pinned: input.pinned ?? true,
  })
}

export function readSideConversation(sessionId: string): SideConversationRecord | undefined {
  pruneExpiredSideConversations()
  return sideConversations.get(sessionId)
}

export function refreshSideConversation(sessionId: string, ttlMs = DEFAULT_SIDE_CONVERSATION_TTL_MS): SideConversationRecord | undefined {
  const record = readSideConversation(sessionId)
  if (!record) {
    return undefined
  }
  record.expiresAt = currentTimeMs() + ttlMs
  record.lease.refresh(ttlMs)
  return record
}

export function releaseSideConversation(sessionId: string): void {
  sideConversations.get(sessionId)?.lease.release()
  sideConversations.delete(sessionId)
}

export function releaseSideConversationsByProviderTargetId(providerTargetId: string): void {
  for (const [sessionId, record] of sideConversations) {
    if (record.providerTargetId !== providerTargetId) {
      continue
    }
    record.lease.release()
    sideConversations.delete(sessionId)
  }
}

export function clearSideConversations(): void {
  for (const record of sideConversations.values()) {
    record.lease.release()
  }
  sideConversations.clear()
}
