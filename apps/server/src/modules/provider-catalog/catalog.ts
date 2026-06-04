import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { readProviderDefaultModelCapabilities } from './model-capabilities'
import { normalizeBaseUrl, OpenAICompatibleConfigJsonSchema, UniversalProviderConfigJsonSchema } from '../provider-contracts/provider-base'
import type { ModelDescriptor, ProviderKind, ProviderRequest } from '../provider-contracts/types'

export interface ProviderMetadataProvider {
  readonly providerKind: ProviderKind
  listModels: (
    input: ProviderRequest,
    deps: { readSecret: (secretRef: string) => string },
  ) => Promise<ModelDescriptor[]>
}

const TRAILING_SLASH_RE = /\/$/
const VERSIONED_API_PATH_RE = /\/v\d+\/?$/i
const ANTHROPIC_VERSION = '2023-06-01'
const OpenAICompatibleModelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .min(1),
})

const AnthropicModelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        display_name: z.string().optional(),
      }),
    )
    .min(1),
})
const AnthropicProviderConfigJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(
    z
      .object({
        baseUrl: z.string().default('https://api.anthropic.com/v1'),
      })
      .passthrough(),
  )

interface ModelsRequestOption {
  url: string
  headers?: HeadersInit
}

export class ProviderCatalog {
  private readonly providers = new Map<ProviderKind, ProviderMetadataProvider>()

  constructor() {
    this.register(new OpenAICompatibleMetadataProvider())
    this.register(new AnthropicMetadataProvider())
    this.register(new UniversalMetadataProvider())
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

  async listModels(
    input: ProviderRequest,
    deps: { readSecret: (secretRef: string) => string },
  ): Promise<ModelDescriptor[]> {
    const config = OpenAICompatibleConfigJsonSchema.parse(input.configJson)
    if (!config.baseUrl) {
      throw invalidProviderRequest('Base URL is required')
    }

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl)

    try {
      const payload = OpenAICompatibleModelsResponseSchema.parse(
        await fetchModelsPayload(
          this.providerKind,
          modelRequestOptions(baseUrl, apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined),
        ),
      )

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

  async listModels(
    input: ProviderRequest,
    deps: { readSecret: (secretRef: string) => string },
  ): Promise<ModelDescriptor[]> {
    const config = AnthropicProviderConfigJsonSchema.parse(input.configJson)

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl).replace(TRAILING_SLASH_RE, '')

    try {
      const payload = AnthropicModelsResponseSchema.parse(
        await fetchModelsPayload(
          this.providerKind,
          modelRequestOptions(baseUrl, {
            'anthropic-version': ANTHROPIC_VERSION,
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
          }),
        ),
      )

      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name ?? item.id,
        providerKind: 'anthropic' as const,
        capabilities: readProviderDefaultModelCapabilities('anthropic'),
      }))
    }
 catch (error) {
      throw wrapProviderModelsError(this.providerKind, error)
    }
  }
}

class UniversalMetadataProvider implements ProviderMetadataProvider {
  readonly providerKind = 'universal' as const

  async listModels(
    input: ProviderRequest,
    deps: { readSecret: (secretRef: string) => string },
  ): Promise<ModelDescriptor[]> {
    const config = UniversalProviderConfigJsonSchema.parse(input.configJson)
    if (!config.baseUrl) {
      throw invalidProviderRequest('Base URL is required')
    }

    const apiKey = input.secretRef ? deps.readSecret(input.secretRef) : null
    const baseUrl = normalizeBaseUrl(config.baseUrl)

    // Try OpenAI format first, fall back to Anthropic format
    try {
      const payload = OpenAICompatibleModelsResponseSchema.parse(
        await fetchModelsPayload(
          'openai-compatible',
          modelRequestOptions(baseUrl, apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined),
        ),
      )
      return payload.data.map(item => ({
        id: item.id,
        label: item.id,
        providerKind: 'universal' as const,
        capabilities: {},
      }))
    }
    catch {
      // OpenAI format failed — try Anthropic format
    }

    try {
      const anthropicBaseUrl = baseUrl.replace(TRAILING_SLASH_RE, '')
      const payload = AnthropicModelsResponseSchema.parse(
        await fetchModelsPayload(
          'anthropic',
          modelRequestOptions(anthropicBaseUrl, {
            'anthropic-version': ANTHROPIC_VERSION,
            ...(apiKey ? { 'x-api-key': apiKey } : {}),
          }),
        ),
      )
      return payload.data.map(item => ({
        id: item.id,
        label: item.display_name ?? item.id,
        providerKind: 'universal' as const,
        capabilities: readProviderDefaultModelCapabilities('anthropic'),
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

function modelRequestOptions(baseUrl: string, headers?: HeadersInit): ModelsRequestOption[] {
  const normalized = normalizeBaseUrl(baseUrl).replace(TRAILING_SLASH_RE, '')
  const urls = VERSIONED_API_PATH_RE.test(normalized)
    ? [`${normalized}/models`]
    : [`${normalized}/v1/models`, `${normalized}/models`]

  return urls.map(url => ({ url, headers }))
}

async function fetchModelsPayload(
  providerKind: ProviderKind,
  options: ModelsRequestOption[],
): Promise<unknown> {
  let lastError: unknown = null

  for (const option of options) {
    try {
      const response = await fetch(option.url, { headers: option.headers })
      if (response.ok) {
        return response.json()
      }
      lastError = providerModelsUnavailable(
        providerKind,
        `Provider models request failed at ${option.url} with status ${response.status}`,
      )
    }
 catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }

  throw providerModelsUnavailable(providerKind, 'Provider models request failed')
}

// ── singleton accessor ──

let _catalog: ProviderCatalog | null = null

export function getProviderCatalog(): ProviderCatalog {
  _catalog ??= new ProviderCatalog()
  return _catalog
}
