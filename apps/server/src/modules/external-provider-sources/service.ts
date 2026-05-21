import { createHash, randomUUID } from 'node:crypto'

import {
  agentProfiles,
  externalProviderProfileLinks,
  externalProviderRecords,
  externalProviderSources,
} from '@cradle/db'
import { and, eq, inArray } from 'drizzle-orm'

import type {
  ExternalProviderCredential,
  ExternalProviderInventory,
  ExternalProviderRecord,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning,
} from '@cradle/plugin-sdk/server'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { listExternalProviderSources as listRegisteredExternalProviderSources, getExternalProviderSource } from '../../plugins/external-provider-source-registry'
import { upsertMirroredProfile } from '../profiles/service'
import { upsertSecretInDb } from '../secrets/service'
import { getExternalProfileLinkRow } from './profile-link-store'

export interface ExternalProviderSourceView {
  id: string
  pluginName: string
  sourceId: string
  label: string
  description: string | null
  enabled: boolean
  capabilities: Record<string, unknown>
  inventory: Record<string, unknown>
  warnings: ExternalProviderWarning[]
  lastSyncStatus: 'never' | 'ok' | 'warning' | 'error'
  lastSyncMessage: string | null
  lastSyncError: string | null
  lastSyncAt: number | null
  registeredAt: number
}

export interface ExternalProviderRecordView {
  id: string
  sourceKey: string
  externalId: string
  app: string
  name: string
  providerKind: 'anthropic' | 'openai-compatible'
  status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'
  fingerprint: string
  metadata: Record<string, unknown>
  warnings: ExternalProviderWarning[]
  lastSeenAt: number
  createdAt: number
  updatedAt: number
}

export interface ExternalProfileLinkView {
  id: string
  sourceKey: string
  externalRecordId: string
  profileId: string
  credentialRef: string | null
  sourceOwnedFields: string[]
  lastProjectedFingerprint: string
  createdAt: number
  updatedAt: number
}

export interface ExternalProviderRefreshResult {
  sourceKey: string
  status: 'ok' | 'warning' | 'error'
  recordsSeen: number
  recordsProjected: number
  recordsMissing: number
  message?: string
}

type Tx = ReturnType<typeof db>

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function stableJson(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function deriveProfileId(sourceKey: string, externalId: string): string {
  return `external_profile_${hashText(`${sourceKey}\0${externalId}`).slice(0, 24)}`
}

function deriveCredentialId(sourceKey: string, externalId: string): string {
  return `external_credential_${hashText(`${sourceKey}\0${externalId}`).slice(0, 24)}`
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  }
  catch {
    return fallback
  }
}

function normalizeWarnings(warnings?: ExternalProviderWarning[]): ExternalProviderWarning[] {
  return warnings ?? []
}

function normalizeInventory(inventory?: ExternalProviderInventory): Record<string, unknown> {
  return { ...(inventory ?? {}) }
}

function normalizeCredential(credential?: ExternalProviderCredential): Record<string, unknown> | null {
  if (!credential) {
    return null
  }
  return { kind: credential.kind, label: credential.label ?? null, value: credential.value }
}

function recordFingerprint(record: ExternalProviderRecord): string {
  return hashText(stableJson({
    app: record.app,
    name: record.name,
    providerKind: record.providerKind,
    config: record.config,
    credential: normalizeCredential(record.credential),
    current: record.current ?? false,
    enabled: record.enabled ?? true,
    readonly: record.readonly ?? false,
    metadata: record.metadata ?? {},
    warnings: normalizeWarnings(record.warnings),
  }))
}

function sourceStatusFromWarnings(warnings: ExternalProviderWarning[]): 'ok' | 'warning' | 'error' {
  return warnings.some(warning => warning.severity === 'error')
    ? 'error'
    : warnings.length > 0
      ? 'warning'
      : 'ok'
}

function toSourceView(row: typeof externalProviderSources.$inferSelect | null, fallback: {
  id: string
  pluginName: string
  sourceId: string
  label: string
  description?: string
  capabilities?: Record<string, unknown>
  warnings?: ExternalProviderWarning[]
  inventory?: Record<string, unknown>
  registeredAt: number
}): ExternalProviderSourceView {
  return {
    id: fallback.id,
    pluginName: row?.pluginName ?? fallback.pluginName,
    sourceId: row?.sourceId ?? fallback.sourceId,
    label: row?.label ?? fallback.label,
    description: row?.description ?? fallback.description ?? null,
    enabled: row?.enabled ?? true,
    capabilities: row ? parseJson<Record<string, unknown>>(row.capabilitiesJson, fallback.capabilities ?? {}) : (fallback.capabilities ?? {}),
    inventory: row ? parseJson<Record<string, unknown>>(row.inventoryJson, fallback.inventory ?? {}) : (fallback.inventory ?? {}),
    warnings: row ? parseJson<ExternalProviderWarning[]>(row.warningsJson, fallback.warnings ?? []) : (fallback.warnings ?? []),
    lastSyncStatus: row?.lastSyncStatus ?? 'never',
    lastSyncMessage: row?.lastSyncMessage ?? null,
    lastSyncError: row?.lastSyncError ?? null,
    lastSyncAt: row?.lastSyncAt ?? null,
    registeredAt: fallback.registeredAt,
  }
}

function toRecordView(row: typeof externalProviderRecords.$inferSelect): ExternalProviderRecordView {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    externalId: row.externalId,
    app: row.app,
    name: row.name,
    providerKind: row.providerKind,
    status: row.status,
    fingerprint: row.fingerprint,
    metadata: parseJson<Record<string, unknown>>(row.metadataJson, {}),
    warnings: parseJson<ExternalProviderWarning[]>(row.warningsJson, []),
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toLinkView(row: typeof externalProviderProfileLinks.$inferSelect): ExternalProfileLinkView {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    externalRecordId: row.externalRecordId,
    profileId: row.profileId,
    credentialRef: row.credentialRef,
    sourceOwnedFields: parseJson<string[]>(row.sourceOwnedFieldsJson, []),
    lastProjectedFingerprint: row.lastProjectedFingerprint,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function syncSourceRow(
  database: Tx,
  sourceKey: string,
  owner: string,
  sourceId: string,
  label: string,
  description: string | null,
  capabilities: Record<string, unknown>,
  snapshot: ExternalProviderSourceSnapshot,
  status: 'ok' | 'warning' | 'error',
  message?: string,
  error?: string,
): void {
  const now = nowUnix()
  database.insert(externalProviderSources).values({
    id: sourceKey,
    pluginName: owner,
    sourceId,
    label,
    description,
    enabled: true,
    capabilitiesJson: JSON.stringify(capabilities),
    inventoryJson: JSON.stringify(normalizeInventory(snapshot.inventory)),
    warningsJson: JSON.stringify(normalizeWarnings(snapshot.warnings)),
    lastSyncStatus: status,
    lastSyncMessage: message ?? snapshot.source.message ?? null,
    lastSyncError: error ?? null,
    lastSyncAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: externalProviderSources.id,
    set: {
      pluginName: owner,
      sourceId,
      label,
      description,
      enabled: true,
      capabilitiesJson: JSON.stringify(capabilities),
      inventoryJson: JSON.stringify(normalizeInventory(snapshot.inventory)),
      warningsJson: JSON.stringify(normalizeWarnings(snapshot.warnings)),
      lastSyncStatus: status,
      lastSyncMessage: message ?? snapshot.source.message ?? null,
      lastSyncError: error ?? null,
      lastSyncAt: now,
      updatedAt: now,
    },
  }).run()
}

function syncRecordRow(database: Tx, sourceKey: string, record: ExternalProviderRecord, status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'): string {
  const now = nowUnix()
  const id = deriveProfileId(sourceKey, record.externalId)
  database.insert(externalProviderRecords).values({
    id,
    sourceKey,
    externalId: record.externalId,
    app: record.app,
    name: record.name,
    providerKind: record.providerKind,
    status,
    fingerprint: recordFingerprint(record),
    metadataJson: JSON.stringify(record.metadata ?? {}),
    warningsJson: JSON.stringify(normalizeWarnings(record.warnings)),
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: externalProviderRecords.id,
    set: {
      app: record.app,
      name: record.name,
      providerKind: record.providerKind,
      status,
      fingerprint: recordFingerprint(record),
      metadataJson: JSON.stringify(record.metadata ?? {}),
      warningsJson: JSON.stringify(normalizeWarnings(record.warnings)),
      lastSeenAt: now,
      updatedAt: now,
    },
  }).run()
  return id
}

function syncProfileProjection(database: Tx, sourceKey: string, record: ExternalProviderRecord): void {
  const profileId = deriveProfileId(sourceKey, record.externalId)
  const credentialRef = record.credential
      ? upsertSecretInDb(database, {
        id: deriveCredentialId(sourceKey, record.externalId),
        kind: record.credential.kind,
        label: record.credential.label ?? record.name,
        secret: record.credential.value,
      }).id
    : null

  upsertMirroredProfile({
    id: profileId,
    name: record.name,
    providerKind: record.providerKind,
    enabled: record.enabled ?? true,
    configJson: JSON.stringify(record.config),
    credentialRef,
  }, database)

  const now = nowUnix()
  database.insert(externalProviderProfileLinks).values({
    id: randomUUID(),
    sourceKey,
    externalRecordId: record.externalId,
    profileId,
    credentialRef,
    sourceOwnedFieldsJson: JSON.stringify(['name', 'providerKind', 'enabled', 'configJson', 'credentialRef']),
    lastProjectedFingerprint: recordFingerprint(record),
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: externalProviderProfileLinks.profileId,
    set: {
      sourceKey,
      externalRecordId: record.externalId,
      credentialRef,
      lastProjectedFingerprint: recordFingerprint(record),
      updatedAt: now,
    },
  }).run()
}

export function listExternalProviderSources(): ExternalProviderSourceView[] {
  const registered = listRegisteredExternalProviderSources()
  const rows = db().select().from(externalProviderSources).all()
  const byId = new Map(rows.map(row => [row.id, row]))
  return registered.map(source => toSourceView(byId.get(source.key) ?? null, {
    id: source.key,
    pluginName: source.owner,
    sourceId: source.source.id,
    label: source.source.label,
    description: source.source.description,
    capabilities: { ...(source.source.capabilities ?? {}) },
    warnings: [],
    inventory: {},
    registeredAt: source.registeredAt,
  }))
}

export function listExternalProviderRecords(): ExternalProviderRecordView[] {
  return db().select().from(externalProviderRecords).all().map(toRecordView)
}

export function getExternalProfileLink(profileId: string): ExternalProfileLinkView | null {
  const row = getExternalProfileLinkRow(profileId)
  return row ? toLinkView(row as typeof externalProviderProfileLinks.$inferSelect) : null
}

export function isExternalProfile(profileId: string): boolean {
  return getExternalProfileLinkRow(profileId) !== null
}

export async function refreshExternalProviderSource(sourceKey: string): Promise<ExternalProviderRefreshResult> {
  const registered = getExternalProviderSource(sourceKey)
  if (!registered) {
    throw new AppError({
      code: 'external_source_not_found',
      status: 404,
      message: 'External provider source not found',
      details: { sourceKey },
    })
  }

  try {
    const snapshot = await registered.source.readSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map(),
    })

    const status = sourceStatusFromWarnings(normalizeWarnings(snapshot.warnings))
    const seenRecordIds = new Set<string>()
    let missingCount = 0

    db().transaction((tx) => {
      syncSourceRow(
        tx,
        sourceKey,
        registered.owner,
        registered.source.id,
        registered.source.label,
        registered.source.description ?? null,
        { ...(registered.source.capabilities ?? {}) },
        snapshot,
        status,
        snapshot.source.message,
      )

      for (const record of snapshot.providers) {
        const recordStatus = record.readonly ? 'unsupported' : 'active'
        syncRecordRow(tx, sourceKey, record, recordStatus)
        syncProfileProjection(tx, sourceKey, record)
        seenRecordIds.add(record.externalId)
      }

      const existing = tx
        .select({ externalId: externalProviderRecords.externalId })
        .from(externalProviderRecords)
        .where(eq(externalProviderRecords.sourceKey, sourceKey))
        .all()

      const missing = existing.filter(row => !seenRecordIds.has(row.externalId)).map(row => row.externalId)
      missingCount = missing.length
      if (missing.length > 0) {
        const missingProfileIds = missing.map(externalId => deriveProfileId(sourceKey, externalId))
        tx.update(externalProviderRecords)
          .set({ status: 'missing', updatedAt: nowUnix() })
          .where(and(eq(externalProviderRecords.sourceKey, sourceKey), inArray(externalProviderRecords.externalId, missing)))
          .run()
        tx.update(agentProfiles)
          .set({ enabled: false, updatedAt: nowUnix() })
          .where(inArray(agentProfiles.id, missingProfileIds))
          .run()
      }
    })

    return {
      sourceKey,
      status,
      recordsSeen: snapshot.providers.length,
      recordsProjected: snapshot.providers.length,
      recordsMissing: missingCount,
      message: snapshot.source.message,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const now = nowUnix()
    db().insert(externalProviderSources).values({
      id: sourceKey,
      pluginName: registered.owner,
      sourceId: registered.source.id,
      label: registered.source.label,
      description: registered.source.description ?? null,
      enabled: true,
      capabilitiesJson: JSON.stringify(registered.source.capabilities ?? {}),
      inventoryJson: '{}',
      warningsJson: '[]',
      lastSyncStatus: 'error',
      lastSyncMessage: null,
      lastSyncError: message,
      lastSyncAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: externalProviderSources.id,
      set: {
        lastSyncStatus: 'error',
        lastSyncMessage: null,
        lastSyncError: message,
        lastSyncAt: now,
        updatedAt: now,
      },
    }).run()

    return {
      sourceKey,
      status: 'error',
      recordsSeen: 0,
      recordsProjected: 0,
      recordsMissing: 0,
      message,
    }
  }
}

export async function refreshAllExternalProviderSources(): Promise<ExternalProviderRefreshResult[]> {
  const results: ExternalProviderRefreshResult[] = []
  for (const source of listRegisteredExternalProviderSources()) {
    results.push(await refreshExternalProviderSource(source.key))
  }
  return results
}
