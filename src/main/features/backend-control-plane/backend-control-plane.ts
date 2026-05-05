// Input: random UUIDs, Drizzle DB schema, and backend control-plane types/store contracts
// Output: DB-backed backend control-plane store plus application service and singleton accessor
// Position: Feature owner for Cradle's backend bindings, run lifecycle, and capability snapshots

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { getDb } from '../../db'
import type * as schema from '../../db/schema'
import {
  backendCapabilitySnapshots,
  backendRuns,
  backendSessionBindings,
} from '../../db/schema'
import type {
  BackendControlPlaneService,
  BackendControlPlaneStore,
} from './types'

export type {
  AttachBackendBindingInput,
  BackendCapabilitySnapshot,
  BackendRun,
  BackendSessionBinding,
  FinishBackendRunInput,
  RecordBackendCapabilitySnapshotInput,
  StartBackendRunInput,
} from './types'

export function createDbBackendControlPlaneStore(
  db: BetterSQLite3Database<typeof schema>,
): BackendControlPlaneStore {
  return {
    getBindingByChatSessionId(chatSessionId) {
      return db
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, chatSessionId))
        .get()
    },
    listBindingsByBackendSessionId(backendSessionId) {
      return db
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.backendSessionId, backendSessionId))
        .all()
    },
    upsertBinding(input) {
      const now = nowUnix()
      const existing = db
        .select()
        .from(backendSessionBindings)
        .where(eq(backendSessionBindings.chatSessionId, input.chatSessionId))
        .get()

      if (existing) {
        db.update(backendSessionBindings)
          .set({
            agentProfileId: input.agentProfileId,
            providerKind: input.providerKind,
            backendSessionId: input.backendSessionId,
            backendStateSnapshot: input.backendStateSnapshot,
            requestedModelId: input.requestedModelId,
            configSnapshot: input.configSnapshot,
            updatedAt: now,
          })
          .where(eq(backendSessionBindings.id, existing.id))
          .run()
        return db
          .select()
          .from(backendSessionBindings)
          .where(eq(backendSessionBindings.id, existing.id))
          .get()!
      }

      return db.insert(backendSessionBindings)
        .values({
          id: randomUUID(),
          chatSessionId: input.chatSessionId,
          agentProfileId: input.agentProfileId,
          providerKind: input.providerKind,
          backendSessionId: input.backendSessionId,
          backendStateSnapshot: input.backendStateSnapshot,
          requestedModelId: input.requestedModelId,
          configSnapshot: input.configSnapshot,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()
    },
    createRun(input) {
      return db.insert(backendRuns)
        .values({
          id: randomUUID(),
          bindingId: input.bindingId,
          chatSessionId: input.chatSessionId,
          messageId: input.messageId,
          origin: input.origin,
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: nowUnix(),
          finishedAt: null,
        })
        .returning()
        .get()
    },
    updateRun(input) {
      db.update(backendRuns)
        .set({
          status: input.status,
          stopReason: input.stopReason ?? null,
          errorText: input.errorText ?? null,
          finishedAt: nowUnix(),
        })
        .where(eq(backendRuns.id, input.runId))
        .run()
      const run = db.select().from(backendRuns).where(eq(backendRuns.id, input.runId)).get()
      if (!run) {
        throw new Error(`Backend run not found: ${input.runId}`)
      }
      return run
    },
    insertCapabilitySnapshot(input) {
      return db.insert(backendCapabilitySnapshots)
        .values({
          id: randomUUID(),
          agentProfileId: input.agentProfileId,
          providerKind: input.providerKind,
          source: input.source,
          capabilitiesJson: input.capabilitiesJson,
          recordedAt: nowUnix(),
        })
        .returning()
        .get()
    },
  }
}

export function createBackendControlPlaneService(deps: {
  store: BackendControlPlaneStore
}): BackendControlPlaneService {
  return {
    getBinding(chatSessionId) {
      return deps.store.getBindingByChatSessionId(chatSessionId)
    },
    listBindingsByBackendSessionId(backendSessionId) {
      return deps.store.listBindingsByBackendSessionId(backendSessionId)
    },
    attachBinding(input) {
      const existing = deps.store.getBindingByChatSessionId(input.chatSessionId)
      return deps.store.upsertBinding({
        ...input,
        backendSessionId: input.backendSessionId ?? existing?.backendSessionId ?? null,
        backendStateSnapshot: input.backendStateSnapshot ?? existing?.backendStateSnapshot ?? null,
        requestedModelId: input.requestedModelId ?? existing?.requestedModelId ?? null,
        configSnapshot: input.configSnapshot ?? existing?.configSnapshot ?? null,
      })
    },
    startRun(input) {
      const binding = deps.store.getBindingByChatSessionId(input.chatSessionId)
      if (!binding) {
        throw new Error(`Backend binding not found for chat session: ${input.chatSessionId}`)
      }
      return deps.store.createRun({
        ...input,
        bindingId: binding.id,
      })
    },
    finishRun(input) {
      return deps.store.updateRun(input)
    },
    recordCapabilitySnapshot(input) {
      return deps.store.insertCapabilitySnapshot(input)
    },
  }
}

let backendControlPlaneService: BackendControlPlaneService | null = null

export function getBackendControlPlaneService(): BackendControlPlaneService {
  if (!backendControlPlaneService) {
    backendControlPlaneService = createBackendControlPlaneService({
      store: createDbBackendControlPlaneStore(getDb()),
    })
  }
  return backendControlPlaneService
}

export function resetBackendControlPlaneServiceForTests(): void {
  backendControlPlaneService = null
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

export type { BackendCapabilityRecorder } from './types'
