// Input: provider request config, secret reader, and provider metadata HTTP fetches
// Output: provider metadata registry for provider-facing capability queries
// Position: apps/server/src/modules/providers/provider-catalog.ts

import { AppError } from '../../errors/app-error'
import { enrichModelsFromRegistry } from './model-info-registry'
import {
  ClaudeAgentConfigSchema,
  CodexConfigSchema,
  normalizeBaseUrl,
  OpenAICompatibleConfigSchema,
  parseConfigWith,
  resolveApiKey,
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
    this.register(new ClaudeAgentMetadataProvider())
    this.register(new CodexMetadataProvider())
  }

  register(provider: ProviderMetadataProvider): void {
    this.providers.set(provider.providerKind, provider)
  }

  get(providerKind: ProviderKind): ProviderMetadataProvider | undefined {
    return this.providers.get(providerKind)
  }
}

class ClaudeAgentMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'claude-agent' as const

  async checkHealth(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ProviderHealthCheckResult> {
    const config = parseConfigWith(input.configJson, ClaudeAgentConfigSchema)
    const apiKey = resolveApiKey(input, config.apiKey, 'ANTHROPIC_API_KEY', deps)
    if (!apiKey) {
      return {
        ok: false,
        label: input.label,
        version: null,
        details: {},
        errorText: 'API key is required (secret or ANTHROPIC_API_KEY env)',
      }
    }

    return {
      ok: true,
      label: input.label,
      version: null,
      details: {
        baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://api.anthropic.com/v1'),
        model: config.model ?? null,
      },
      errorText: null,
    }
  }

  async listModels(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(input.configJson, ClaudeAgentConfigSchema)
    const apiKey = resolveApiKey(input, config.apiKey, 'ANTHROPIC_API_KEY', deps)
    if (!apiKey) {
      throw invalidProviderRequest('API key is required (secret or ANTHROPIC_API_KEY env)')
    }

    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.anthropic.com/v1')
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      })

      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Claude models request failed with status ${response.status}`)
      }

      const payload = await response.json() as { data?: Array<{ id: string, display_name?: string }> }
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw providerModelsUnavailable(this.providerKind, 'Claude models response was empty')
      }

      const models = await enrichModelsFromRegistry(payload.data.map(item => ({
        id: item.id,
        label: item.display_name ?? item.id,
        providerKind: this.providerKind,
        contextWindow: null,
      })))

      return filterEnabledModels(models, config.enabledModels)
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

class CodexMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'codex' as const

  async checkHealth(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ProviderHealthCheckResult> {
    const config = parseConfigWith(input.configJson, CodexConfigSchema)
    const apiKey = resolveApiKey(input, config.apiKey, 'OPENAI_API_KEY', deps)
    if (!apiKey) {
      return {
        ok: false,
        label: input.label,
        version: null,
        details: { baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1') },
        errorText: 'API key is required (secret or OPENAI_API_KEY env)',
      }
    }

    return {
      ok: true,
      label: input.label,
      version: null,
      details: {
        baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1'),
        model: config.model ?? null,
      },
      errorText: null,
    }
  }

  async listModels(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(input.configJson, CodexConfigSchema)
    const apiKey = resolveApiKey(input, config.apiKey, 'OPENAI_API_KEY', deps)
    if (!apiKey) {
      throw invalidProviderRequest('API key is required (secret or OPENAI_API_KEY env)')
    }

    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1')

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Codex models request failed with status ${response.status}`)
      }

      const payload = await response.json() as { data?: Array<{ id: string }> }
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw providerModelsUnavailable(this.providerKind, 'Codex models response was empty')
      }

      const models = await enrichModelsFromRegistry(payload.data.map(item => ({
        id: item.id,
        label: item.id,
        providerKind: this.providerKind,
        contextWindow: null,
      })))

      return filterEnabledModels(models, config.enabledModels)
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
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

    try {
      const response = await fetch(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      })
      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Provider models request failed with status ${response.status}`)
      }

      const payload = await response.json() as { data?: Array<{ id: string }> }
      if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw providerModelsUnavailable(this.providerKind, 'Provider models response was empty')
      }

      const models = payload.data.map(item => toModelDescriptor(item.id))
      return filterEnabledModels(models, config.enabledModels)
    }
    catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

function toModelDescriptor(id: string): ModelDescriptor {
  return {
    id,
    label: id,
    providerKind: 'openai-compatible',
    contextWindow: null,
  }
}

function filterEnabledModels(models: ModelDescriptor[], enabledModels: string[] | undefined): ModelDescriptor[] {
  if (enabledModels === undefined) {
    return models
  }
  if (enabledModels.length === 0) {
    return []
  }
  return models.filter(model => enabledModels.includes(model.id))
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
