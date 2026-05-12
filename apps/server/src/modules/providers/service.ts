import { randomUUID } from 'node:crypto'

import {
  backendCapabilitySnapshots,
  runtimeAuditLog,
} from '@cradle/db'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as Secrets from '../secrets/service'
import { getProviderCatalog } from './provider-catalog'
import type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind, ProviderRequest } from './types'

// ── provider body parsing ──

interface ProviderBodyInput {
  providerKind: ProviderKind
  label: string
  config: Record<string, unknown>
  secretRef?: string | null
  profileId?: string | null
}

export function parseProviderBody(body: ProviderBodyInput): ProviderRequest {
  return {
    providerKind: body.providerKind,
    label: body.label,
    configJson: JSON.stringify(body.config),
    secretRef: normalizeNullableString(body.secretRef, 'secretRef'),
    profileId: normalizeNullableString(body.profileId, 'profileId'),
  }
}

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
      errorText: result.errorText ?? null,
    })
    recordCapabilitySnapshot({
      profileId: input.profileId,
      providerKind: input.providerKind,
      capabilitiesJson: JSON.stringify(result.details ?? {}),
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
  try {
    const models = await provider.listModels(input, {
      readSecret: secretRef => Secrets.readSecret(secretRef),
    })
    recordModelList({
      profileId: input.profileId,
      providerKind: input.providerKind,
      subject: input.label,
      count: models.length,
    })
    return models
  }
  catch (error) {
    throw mapOperationalError(error)
  }
}

// ── audit persistence (merged from store) ──

function recordHealthCheck(input: {
  profileId?: string | null
  providerKind: ProviderKind
  subject: string
  ok: boolean
  errorText: string | null
}): void {
  try {
    db().insert(runtimeAuditLog).values({
      agentProfileId: input.profileId ?? null,
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
  db().insert(runtimeAuditLog).values({
    agentProfileId: input.profileId ?? null,
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
    providerKind: input.providerKind,
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

function normalizeNullableString(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_provider_input',
      status: 400,
      message: `${field} must not be blank`,
    })
  }
  return trimmed
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
