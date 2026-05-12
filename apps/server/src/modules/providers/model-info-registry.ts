// Input: fetch from https://models.dev/api.json
// Output: best-effort model metadata enrichment
// Position: apps/server/src/modules/providers/model-info-registry.ts

import type { ModelDescriptor } from './types'

interface ModelsDevModel {
  id: string
  name?: string
  limit?: { context?: number, output?: number }
}

interface ModelsDevProvider {
  models: Record<string, ModelsDevModel>
}

type ModelsDevData = Record<string, ModelsDevProvider>

const MODELS_DEV_URL = 'https://models.dev/api.json'
const CACHE_TTL_MS = 1000 * 60 * 60

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

function findModel(data: ModelsDevData, modelId: string): ModelsDevModel | null {
  for (const provider of Object.values(data)) {
    const model = provider.models?.[modelId]
    if (model) {
      return model
    }
  }
  return null
}

export async function enrichModelsFromRegistry(models: ModelDescriptor[]): Promise<ModelDescriptor[]> {
  const data = await fetchModelsDevData()
  if (!data) {
    return models
  }

  return models.map((model) => {
    const info = findModel(data, model.id)
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
