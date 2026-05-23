import { createHash, randomUUID } from 'node:crypto'

import {
  agentProfiles,
  externalProviderProfileLinks,
  externalProviderRecords,
  externalProviderSources,
} from '@cradle/db'
import type { ExternalProviderWarning } from '@cradle/plugin-sdk/server'
import { and, eq, inArray } from 'drizzle-orm'
import stringify from 'safe-stable-stringify'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { getExternalProviderSource, listExternalProviderSources as listRegisteredExternalProviderSources } from '../../plugins/external-provider-source-registry'
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

const JsonValueSchema = z.json()
const JsonRecordSchema = z.record(z.string(), JsonValueSchema)

const ExternalProviderWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
})

const ExternalProviderWarningsSchema = z.array(ExternalProviderWarningSchema).default([])

const ExternalProviderSourceCapabilitiesSchema = z.object({
  refresh: z.boolean().optional(),
  revealSourceFile: z.boolean().optional(),
  importAsNative: z.boolean().optional(),
}).default({})

const ExternalProviderCredentialSchema = z.object({
  kind: z.literal('api-key'),
  value: z.string(),
  label: z.string().optional(),
})

const ExternalProviderRecordSchema = z.object({
  externalId: z.string(),
  app: z.string(),
  name: z.string(),
  providerKind: z.enum(['anthropic', 'openai-compatible']),
  config: JsonRecordSchema,
  credential: ExternalProviderCredentialSchema.optional(),
  current: z.boolean().default(false),
  readonly: z.boolean().default(false),
  metadata: JsonRecordSchema.default({}),
  warnings: ExternalProviderWarningsSchema,
})

const RegisteredExternalProviderSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().nullable().default(null),
  capabilities: ExternalProviderSourceCapabilitiesSchema,
})

const ExternalProviderSnapshotSchema = z.object({
  source: z.object({
    status: z.enum(['ok', 'warning', 'error']),
    message: z.string().optional(),
    observedAt: z.string().optional(),
  }),
  providers: z.array(ExternalProviderRecordSchema),
  inventory: JsonRecordSchema.default({}),
  warnings: ExternalProviderWarningsSchema,
})

type ParsedExternalProviderRecord = z.infer<typeof ExternalProviderRecordSchema>

const ExternalProviderRecordFingerprintSchema = z.object({
  app: z.string(),
  name: z.string(),
  providerKind: z.enum(['anthropic', 'openai-compatible']),
  config: JsonRecordSchema,
  credential: ExternalProviderCredentialSchema.optional(),
  current: z.boolean(),
  readonly: z.boolean(),
  metadata: JsonRecordSchema,
  warnings: ExternalProviderWarningsSchema,
})

const SourceOwnedFieldsSchema = z.array(z.string()).default([])

const AgentProfileConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(JsonRecordSchema.default({}))
const AgentProfileModelConfigJsonSchema = AgentProfileConfigJsonSchema.transform((config) => {
  return Object.fromEntries(
    Object.entries({
      enabledModels: config.enabledModels,
      modelRegistryMappings: config.modelRegistryMappings,
    }).filter(([, value]) => value !== undefined),
  )
})

const JsonRecordTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(JsonRecordSchema.default({}))

const WarningListTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ExternalProviderWarningsSchema)

const SourceOwnedFieldsTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(SourceOwnedFieldsSchema)

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
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

function recordFingerprint(record: ParsedExternalProviderRecord): string {
  const payload = ExternalProviderRecordFingerprintSchema.parse({
    app: record.app,
    name: record.name,
    providerKind: record.providerKind,
    config: record.config,
    credential: record.credential,
    current: record.current,
    readonly: record.readonly,
    metadata: record.metadata,
    warnings: record.warnings,
  })

  return hashText(stringify(payload))
}

function sourceStatusFromWarnings(warnings: ExternalProviderWarning[]): 'ok' | 'warning' | 'error' {
  return warnings.some(warning => warning.severity === 'error')
    ? 'error'
    : warnings.length > 0
      ? 'warning'
      : 'ok'
}

function toPersistedSourceView(row: typeof externalProviderSources.$inferSelect, registeredAt: number): ExternalProviderSourceView {
  return {
    id: row.id,
    pluginName: row.pluginName,
    sourceId: row.sourceId,
    label: row.label,
    description: row.description,
    enabled: row.enabled,
    capabilities: JsonRecordTextSchema.parse(row.capabilitiesJson),
    inventory: JsonRecordTextSchema.parse(row.inventoryJson),
    warnings: WarningListTextSchema.parse(row.warningsJson),
    lastSyncStatus: row.lastSyncStatus,
    lastSyncMessage: row.lastSyncMessage,
    lastSyncError: row.lastSyncError,
    lastSyncAt: row.lastSyncAt,
    registeredAt,
  }
}

function toRegisteredSourceView(input: {
  id: string
  pluginName: string
  registeredAt: number
  source: z.infer<typeof RegisteredExternalProviderSourceSchema>
}): ExternalProviderSourceView {
  return {
    id: input.id,
    pluginName: input.pluginName,
    sourceId: input.source.id,
    label: input.source.label,
    description: input.source.description,
    enabled: true,
    capabilities: input.source.capabilities,
    inventory: {},
    warnings: [],
    lastSyncStatus: 'never',
    lastSyncMessage: null,
    lastSyncError: null,
    lastSyncAt: null,
    registeredAt: input.registeredAt,
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
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    warnings: WarningListTextSchema.parse(row.warningsJson),
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
    sourceOwnedFields: SourceOwnedFieldsTextSchema.parse(row.sourceOwnedFieldsJson),
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
  snapshot: z.infer<typeof ExternalProviderSnapshotSchema>,
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
    inventoryJson: JSON.stringify(snapshot.inventory),
    warningsJson: JSON.stringify(snapshot.warnings),
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
      inventoryJson: JSON.stringify(snapshot.inventory),
      warningsJson: JSON.stringify(snapshot.warnings),
      lastSyncStatus: status,
      lastSyncMessage: message ?? snapshot.source.message ?? null,
      lastSyncError: error ?? null,
      lastSyncAt: now,
      updatedAt: now,
    },
  }).run()
}

function syncRecordRow(database: Tx, sourceKey: string, record: ParsedExternalProviderRecord, status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'): string {
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
    metadataJson: JSON.stringify(record.metadata),
    warningsJson: JSON.stringify(record.warnings),
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
      metadataJson: JSON.stringify(record.metadata),
      warningsJson: JSON.stringify(record.warnings),
      lastSeenAt: now,
      updatedAt: now,
    },
  }).run()
  return id
}

function syncProfileProjection(database: Tx, sourceKey: string, record: ParsedExternalProviderRecord): void {
  const profileId = deriveProfileId(sourceKey, record.externalId)
  const existingProfile = database.select().from(agentProfiles).where(eq(agentProfiles.id, profileId)).get()
  const enabled = existingProfile?.enabled ?? true
  const existingModelConfig = existingProfile ? AgentProfileModelConfigJsonSchema.parse(existingProfile.configJson) : {}
  const projectedConfig = {
    ...record.config,
    ...existingModelConfig,
  }
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
    enabled,
    configJson: JSON.stringify(projectedConfig),
    credentialRef,
  }, database)

  const now = nowUnix()
  database.insert(externalProviderProfileLinks).values({
    id: randomUUID(),
    sourceKey,
    externalRecordId: record.externalId,
    profileId,
    credentialRef,
    sourceOwnedFieldsJson: JSON.stringify([
      'name',
      'providerKind',
      ...Object.keys(record.config).toSorted().map(key => `configJson.${key}`),
      'credentialRef',
    ]),
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
  return registered.map((source) => {
    const registeredSource = RegisteredExternalProviderSourceSchema.parse(source.source)
    const row = byId.get(source.key)
    if (row) {
      return toPersistedSourceView(row, source.registeredAt)
    }
    return toRegisteredSourceView({
      id: source.key,
      pluginName: source.owner,
      registeredAt: source.registeredAt,
      source: registeredSource,
    })
  })
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
  const registeredSource = RegisteredExternalProviderSourceSchema.parse(registered.source)

  try {
    const snapshot = ExternalProviderSnapshotSchema.parse(await registered.source.readSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map(),
    }))

    const status = sourceStatusFromWarnings(snapshot.warnings)
    const seenRecordIds = new Set<string>()
    let missingCount = 0

    db().transaction((tx) => {
      syncSourceRow(
        tx,
        sourceKey,
        registered.owner,
        registeredSource.id,
        registeredSource.label,
        registeredSource.description,
        registeredSource.capabilities,
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
      sourceId: registeredSource.id,
      label: registeredSource.label,
      description: registeredSource.description,
      enabled: true,
      capabilitiesJson: JSON.stringify(registeredSource.capabilities),
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
