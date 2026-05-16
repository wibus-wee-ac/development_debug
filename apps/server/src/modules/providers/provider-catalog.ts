// Input: provider request config, secret reader, and provider metadata HTTP fetches
// Output: provider metadata registry for LLM connection health and model discovery
// Position: apps/server/src/modules/providers/provider-catalog.ts

import { AppError } from '../../errors/app-error'
import {
  BaseProviderConfig,
  normalizeBaseUrl,
  OpenAICompatibleConfigSchema,
  parseConfigWith,
} from './provider-base'
import type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind, ProviderRequest } from './types'

export interface ProviderMetadataProvider {
  readonly providerKind: ProviderKind
  checkHealth: (input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }) => Promise<ProviderHealthCheckResult>
  listModels: (input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }) => Promise<ModelDescriptor[]>
}

const TRAILING_SLASH_RE = /\/$/

export class ProviderCatalog {
  private readonly providers = new Map<ProviderKind, ProviderMetadataProvider>()

  constructor() {
    this.register(new OpenAICompatibleMetadataProvider())
    this.register(new AnthropicMetadataProvider())
  }

  register(provider: ProviderMetadataProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): ProviderMetadataProvider | undefined {
    return this.providers.get(providerKind)
  }
}

class OpenAICompatibleMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'openai-compatible' as const

  async checkHealth(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ProviderHealthCheckResult> {
    const config = parseConfigWith(input.configJson, OpenAICompatibleConfigSchema)
    if (!config.baseUrl) {
      return {
        ok: false,
        label: input.label,
        version: null,
        details: {},
        errorText: 'Base URL is required',
      }
    }
    if (!input.secretRef) {
      return {
        ok: false,
        label: input.label,
        version: null,
        details: { baseUrl: config.baseUrl },
        errorText: 'API key secretRef is required',
      }
    }

    deps.readSecret(input.secretRef)

    return {
      ok: true,
      label: input.label,
      version: null,
      details: { baseUrl: config.baseUrl },
      errorText: null,
    }
  }

  async listModels(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(input.configJson, OpenAICompatibleConfigSchema)
    if (!config.baseUrl) {
      throw invalidProviderRequest('Base URL is required')
    }

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl)

    try {
      const response = await fetch(`${baseUrl.replace(TRAILING_SLASH_RE, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      })
      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Provider models request failed with status ${response.status}`)
      }

      const payload = await response.json() as { data?: Array<{ id: string }> }
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw providerModelsUnavailable(this.providerKind, 'Provider models response was empty')
      }

      return payload.data.map(item => ({
        id: item.id,
        label: item.id,
        providerKind: 'openai-compatible' as const,
        capabilities: {},
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

class AnthropicMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'anthropic' as const
  private readonly defaultBaseUrl = 'https://api.anthropic.com/v1'

  async checkHealth(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ProviderHealthCheckResult> {
    const config = parseConfigWith(input.configJson, BaseProviderConfig)
    if (!input.secretRef) {
      return {
        ok: false,
        label: input.label,
        version: null,
        details: { baseUrl: config.baseUrl },
        errorText: 'API key secretRef is required',
      }
    }

    deps.readSecret(input.secretRef)

    return {
      ok: true,
      label: input.label,
      version: null,
      details: { baseUrl: config.baseUrl ?? this.defaultBaseUrl },
      errorText: null,
    }
  }

  async listModels(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(input.configJson, BaseProviderConfig)

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? this.defaultBaseUrl).replace(TRAILING_SLASH_RE, '')

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      })
      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Anthropic models request failed with status ${response.status}`)
      }

      const payload = await response.json() as { data?: Array<{ id: string, display_name?: string }> }
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw providerModelsUnavailable(this.providerKind, 'Anthropic models response was empty')
      }

      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name ?? item.id,
        providerKind: 'anthropic' as const,
        capabilities: {},
      }))
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

function invalidProviderRequest(message: string): AppError {
  return new AppError({
    code: 'invalid_provider_request',
    status: 400,
    message,
  })
}

function providerModelsUnavailable(providerKind: ProviderKind, message: string): AppError {
  return new AppError({
    code: 'provider_models_unavailable',
    status: 502,
    message,
    details: { providerKind },
  })
}

function wrapProviderModelsError(providerKind: ProviderKind, error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  return providerModelsUnavailable(providerKind, message)
}

// ── singleton accessor ──

let _catalog: ProviderCatalog | null = null

export function getProviderCatalog(): ProviderCatalog {
  _catalog ??= new ProviderCatalog()
  return _catalog
}
