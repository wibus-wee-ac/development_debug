// Input: fetch from https://models.dev/api.json
// Output: best-effort model metadata enrichment
// Position: apps/server/src/modules/providers/model-info-registry.ts

import type { ModelCapabilities, ModelDescriptor } from './types'

interface ModelsDevModel {
  id: string
  name?: string
  limit?: { context?: number, output?: number }
  modalities?: { input?: string[], output?: string[] }
  reasoning?: boolean
  tool_call?: boolean
  temperature?: boolean
  structured_output?: boolean
  cost?: { input?: number, output?: number, cache_read?: number, cache_write?: number }
  family?: string
  knowledge?: string
  release_date?: string
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

function extractCapabilities(model: ModelsDevModel): ModelCapabilities {
  const caps: ModelCapabilities = {}
  if (model.limit?.context != null) caps.contextWindow = model.limit.context
  if (model.limit?.output != null) caps.maxOutput = model.limit.output
  if (model.modalities?.input) caps.inputModalities = model.modalities.input
  if (model.modalities?.output) caps.outputModalities = model.modalities.output
  if (model.reasoning != null) caps.reasoning = model.reasoning
  if (model.tool_call != null) caps.toolCall = model.tool_call
  if (model.temperature != null) caps.temperature = model.temperature
  if (model.structured_output != null) caps.structuredOutput = model.structured_output
  if (model.cost) {
    const cost: NonNullable<ModelCapabilities['cost']> = {}
    if (model.cost.input != null) cost.input = model.cost.input
    if (model.cost.output != null) cost.output = model.cost.output
    if (model.cost.cache_read != null) cost.cacheRead = model.cost.cache_read
    if (model.cost.cache_write != null) cost.cacheWrite = model.cost.cache_write
    if (Object.keys(cost).length > 0) caps.cost = cost
  }
  if (model.family) caps.family = model.family
  if (model.knowledge) caps.knowledgeCutoff = model.knowledge
  if (model.release_date) caps.releaseDate = model.release_date
  return caps
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
    const registryCaps = extractCapabilities(info)
    return {
      ...model,
      label: info.name ?? model.label,
      capabilities: { ...registryCaps, ...model.capabilities },
    }
  })
}

/**
 * Look up the context window for a single model ID.
 * Returns null if the model is not found in the registry.
 */
export async function lookupContextWindow(modelId: string): Promise<number | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  const info = findModel(data, modelId)
  return info?.limit?.context ?? null
}

/**
 * Look up a single model's metadata from models.dev registry.
 * Returns null if the model is not found.
 */
export async function lookupModel(modelId: string): Promise<{ id: string, label: string, capabilities: ModelCapabilities } | null> {
  const data = await fetchModelsDevData()
  if (!data) {
    return null
  }
  const info = findModel(data, modelId)
  if (!info) {
    return null
  }
  return {
    id: modelId,
    label: info.name ?? modelId,
    capabilities: extractCapabilities(info),
  }
}

/**
 * Search models by substring match on ID or name.
 * Returns up to `limit` results.
 */
export async function searchModels(query: string, limit = 20): Promise<Array<{ id: string, label: string, capabilities: ModelCapabilities }>> {
  const data = await fetchModelsDevData()
  if (!data) {
    return []
  }

  const q = query.toLowerCase()
  const results: Array<{ id: string, label: string, capabilities: ModelCapabilities }> = []

  for (const provider of Object.values(data)) {
    if (!provider.models) continue
    for (const [id, model] of Object.entries(provider.models)) {
      const name = model.name ?? id
      if (id.toLowerCase().includes(q) || name.toLowerCase().includes(q)) {
        results.push({
          id,
          label: name,
          capabilities: extractCapabilities(model),
        })
        if (results.length >= limit) return results
      }
    }
  }

  return results
}
