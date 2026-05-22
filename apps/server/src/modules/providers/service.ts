import { randomUUID } from 'node:crypto'

import {
  agentProfiles,
  backendCapabilitySnapshots,
  runtimeAuditLog,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as Secrets from '../secrets/service'
import { enrichModelsFromRegistryMappings } from './model-info-registry'
import { ProfileConfigWithModelRegistryJsonSchema } from './model-registry-mappings'
import { getProviderCatalog } from './provider-catalog'
import type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind, ProviderRequest } from './types'

// ── provider body parsing ──

const NullableProviderRefSchema = z.string().trim().min(1).nullish().transform((value) => {
  if (value === undefined || value === null) {
    return null
  }
  return value
})

export const ProviderRequestSchema = z.object({
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  label: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  secretRef: NullableProviderRefSchema,
  profileId: NullableProviderRefSchema,
}).transform(parsed => ({
  providerKind: parsed.providerKind,
  label: parsed.label,
  configJson: JSON.stringify(parsed.config),
  secretRef: parsed.secretRef,
  profileId: parsed.profileId,
}))

const CustomModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  contextWindow: z.number().finite().nullable().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional().default({}),
}).transform(({ contextWindow, capabilities, ...model }) => ({
  ...model,
  capabilities: contextWindow != null && capabilities.contextWindow === undefined
    ? { ...capabilities, contextWindow }
    : capabilities,
}))

const CustomModelsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(CustomModelSchema))

const RuntimeAuditProfileInputSchema = z.object({
  profileId: z.string().nullable().default(null),
})

// ── health check ──

export async function healthCheck(input: ProviderRequest): Promise<ProviderHealthCheckResult> {
  const provider = requireProvider(input.providerKind)
  try {
    const result = await provider.checkHealth(input, {
      readSecret: secretRef => Secrets.readSecret(secretRef),
    })
    recordHealthCheck({
      profileId: input.profileId,
      providerKind: input.providerKind,
      subject: input.label,
      ok: result.ok,
      errorText: result.errorText,
    })
    recordCapabilitySnapshot({
      profileId: input.profileId,
      providerKind: input.providerKind,
      capabilitiesJson: JSON.stringify(result.details),
    })
    return result
  }
  catch (error) {
    throw mapOperationalError(error)
  }
}

// ── list models ──

export async function listModels(input: ProviderRequest): Promise<ModelDescriptor[]> {
  const provider = requireProvider(input.providerKind)

  let models: ModelDescriptor[] = []
  try {
    models = await provider.listModels(input, {
      readSecret: secretRef => Secrets.readSecret(secretRef),
    })
    recordModelList({
      profileId: input.profileId,
      providerKind: input.providerKind,
      subject: input.label,
      count: models.length,
    })
  }
  catch (error) {
    // If no profile with custom models, propagate the error
    if (!input.profileId) {
      throw mapOperationalError(error)
    }
    const profile = db().select().from(agentProfiles).where(eq(agentProfiles.id, input.profileId)).get()
    if (!profile?.customModels || profile.customModels === '[]') {
      throw mapOperationalError(error)
    }
    // Upstream failed but we have custom models — fall through to merge them
  }

  // Merge custom models from profile
  if (input.profileId) {
    const profile = db().select().from(agentProfiles).where(eq(agentProfiles.id, input.profileId)).get()
    if (profile?.customModels) {
      const customModels = CustomModelsJsonSchema.parse(profile.customModels)
      const upstreamIds = new Set(models.map(m => m.id))
      for (const cm of customModels) {
        if (!upstreamIds.has(cm.id)) {
          models.push({
            id: cm.id,
            label: cm.label,
            providerKind: input.providerKind,
            capabilities: cm.capabilities,
          })
        }
      }
    }
  }

  const configJson = input.profileId
    ? db()
        .select({ configJson: agentProfiles.configJson })
        .from(agentProfiles)
        .where(eq(agentProfiles.id, input.profileId))
        .get()?.configJson ?? input.configJson
    : input.configJson
  const profileConfig = ProfileConfigWithModelRegistryJsonSchema.parse(configJson)
  models = await enrichModelsFromRegistryMappings(models, profileConfig.modelRegistryMappings)

  return models
}

// ── audit persistence (merged from store) ──

function recordHealthCheck(input: {
  profileId?: string | null
  providerKind: ProviderKind
  subject: string
  ok: boolean
  errorText: string | null
}): void {
  const auditInput = RuntimeAuditProfileInputSchema.parse(input)
  try {
    db().insert(runtimeAuditLog).values({
      agentProfileId: auditInput.profileId,
      providerKind: input.providerKind,
      action: 'healthCheck',
      subject: input.subject,
      details: JSON.stringify({ ok: input.ok, errorText: input.errorText }),
    }).run()
  }
  catch {
    // FK violation possible if profile was deleted mid-request
  }
}

function recordModelList(input: {
  profileId?: string | null
  providerKind: ProviderKind
  subject: string
  count: number
}): void {
  const auditInput = RuntimeAuditProfileInputSchema.parse(input)
  db().insert(runtimeAuditLog).values({
    agentProfileId: auditInput.profileId,
    providerKind: input.providerKind,
    action: 'listModels',
    subject: input.subject,
    details: JSON.stringify({ count: input.count }),
  }).run()
}

function recordCapabilitySnapshot(input: {
  profileId?: string | null
  providerKind: ProviderKind
  capabilitiesJson: string
}): void {
  if (!input.profileId) {
    return
  }
  db().insert(backendCapabilitySnapshots).values({
    id: randomUUID(),
    agentProfileId: input.profileId,
    runtimeKind: 'standard',
    source: 'health_check',
    capabilitiesJson: input.capabilitiesJson,
    recordedAt: Math.floor(Date.now() / 1000),
  }).run()
}

// ── helpers ──

function requireProvider(providerKind: ProviderKind) {
  const catalog = getProviderCatalog()
  const provider = catalog.get(providerKind)
  if (!provider) {
    throw new AppError({
      code: 'provider_not_available',
      status: 501,
      message: `Provider is not available: ${providerKind}`,
      details: { providerKind },
    })
  }
  return provider
}

function mapOperationalError(error: unknown): Error {
  if (error instanceof AppError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'CRADLE_CREDENTIAL_SECRET is not configured') {
    return new AppError({
      code: 'secret_not_configured',
      status: 500,
      message: 'CRADLE_CREDENTIAL_SECRET is required to manage secrets',
    })
  }
  return error instanceof Error ? error : new Error(message)
}
