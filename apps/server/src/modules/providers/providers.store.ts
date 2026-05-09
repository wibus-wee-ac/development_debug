// Input: DbAccessor and provider capability audit payloads
// Output: persistence helpers for provider health checks, model lists, and capability snapshots
// Position: apps/server/src/modules/providers/providers.store.ts

import { randomUUID } from 'node:crypto'

import {
  backendCapabilitySnapshots,
  runtimeAuditLog,
} from '@cradle/db'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import type { ProviderKind } from './types'

@injectable()
export class ProvidersStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  recordHealthCheck(input: { profileId?: string | null, providerKind: ProviderKind, subject: string, ok: boolean, errorText: string | null }): void {
    this.dbAccessor.get().insert(runtimeAuditLog).values({
      agentProfileId: input.profileId ?? null,
      providerKind: input.providerKind,
      action: 'healthCheck',
      subject: input.subject,
      details: JSON.stringify({ ok: input.ok, errorText: input.errorText }),
    }).run()
  }

  recordModelList(input: { profileId?: string | null, providerKind: ProviderKind, subject: string, count: number }): void {
    this.dbAccessor.get().insert(runtimeAuditLog).values({
      agentProfileId: input.profileId ?? null,
      providerKind: input.providerKind,
      action: 'listModels',
      subject: input.subject,
      details: JSON.stringify({ count: input.count }),
    }).run()
  }

  recordCapabilitySnapshot(input: { profileId?: string | null, providerKind: ProviderKind, capabilitiesJson: string }): void {
    if (!input.profileId) {
      return
    }
    this.dbAccessor.get().insert(backendCapabilitySnapshots).values({
      id: randomUUID(),
      agentProfileId: input.profileId,
      providerKind: input.providerKind,
      source: 'health_check',
      capabilitiesJson: input.capabilitiesJson,
      recordedAt: Math.floor(Date.now() / 1000),
    }).run()
  }
}