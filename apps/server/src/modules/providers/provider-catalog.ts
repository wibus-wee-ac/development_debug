import { AppError } from '../../errors/app-error'
import { z } from 'zod'
import {
  normalizeBaseUrl,
  OpenAICompatibleConfigJsonSchema,
} from './provider-base'
import type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind, ProviderRequest } from './types'

export interface ProviderMetadataProvider {
  readonly providerKind: ProviderKind
  checkHealth: (input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }) => Promise<ProviderHealthCheckResult>
  listModels: (input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }) => Promise<ModelDescriptor[]>
}

const TRAILING_SLASH_RE = /\/$/
const OpenAICompatibleModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
  })).min(1),
})

const AnthropicModelsResponseSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    display_name: z.string().optional(),
  })).min(1),
})
const AnthropicProviderConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    baseUrl: z.string().default('https://api.anthropic.com/v1'),
  }).passthrough())

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
    const config = OpenAICompatibleConfigJsonSchema.parse(input.configJson)
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
    const config = OpenAICompatibleConfigJsonSchema.parse(input.configJson)
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

      const payload = OpenAICompatibleModelsResponseSchema.parse(await response.json())

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

  async checkHealth(input: ProviderRequest, deps: { readSecret: (secretRef: string) => string }): Promise<ProviderHealthCheckResult> {
    const config = AnthropicProviderConfigJsonSchema.parse(input.configJson)
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
    const config = AnthropicProviderConfigJsonSchema.parse(input.configJson)

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl).replace(TRAILING_SLASH_RE, '')

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { 'x-api-key': apiKey } : undefined,
      })
      if (!response.ok) {
        throw providerModelsUnavailable(this.providerKind, `Anthropic models request failed with status ${response.status}`)
      }

      const payload = AnthropicModelsResponseSchema.parse(await response.json())

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
