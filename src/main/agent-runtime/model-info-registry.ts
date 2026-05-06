// Input: fetch from https://models.dev/api.json
// Output: Cached model metadata lookup (context window, display name, capabilities)
// Position: Shared utility for enriching provider model lists with community model information

import type { ModelDescriptor } from './runtime-provider-types'

interface ModelsDevModel {
  id: string
  name?: string
  limit?: { context?: number, output?: number }
  tool_call?: boolean
  reasoning?: boolean
}

interface ModelsDevProvider {
  models: Record<string, ModelsDevModel>
}

type ModelsDevData = Record<string, ModelsDevProvider>

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 1000 * 60 * 60 // 1 hour

let cachedData: ModelsDevData | null = null
let cachedAt = 0

async function fetchModelsDevData(): Promise<ModelsDevData | null> {
  if (cachedData && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(MODELS_DEV_URL, { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      return cachedData
    }

    const data = await response.json() as ModelsDevData
    cachedData = data
    cachedAt = Date.now()
    return data
  }
  catch {
    return cachedData
  }
}

function findModelInData(data: ModelsDevData, modelId: string): ModelsDevModel | null {
  // Search all providers for a matching model ID
  for (const provider of Object.values(data)) {
    if (!provider.models) {
      continue
    }
    const model = provider.models[modelId]
    if (model) {
      return model
    }
  }
  return null
}

/**
 * Enrich a list of model descriptors with context window and display name
 * from the community models.dev registry.
 * This is best-effort — if fetch fails or model isn't found, descriptors pass through unchanged.
 */
export async function enrichModelsFromRegistry(models: ModelDescriptor[]): Promise<ModelDescriptor[]> {
  const data = await fetchModelsDevData()
  if (!data) {
    return models
  }

  return models.map((model) => {
    const info = findModelInData(data, model.id)
    if (!info) {
      return model
    }
    return {
      ...model,
      label: info.name ?? model.label,
      contextWindow: info.limit?.context ?? model.contextWindow,
    }
  })
}
