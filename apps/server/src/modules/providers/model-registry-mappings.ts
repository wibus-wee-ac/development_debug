// Input: provider profile config JSON and model registry mapping payloads
// Output: normalized Available Model -> models.dev mapping entries
// Position: provider-owned model metadata mapping helpers

import type { ModelRegistryMappingEntry, ModelsDevModel } from './model-info-registry'

export const MODEL_REGISTRY_MAPPINGS_CONFIG_KEY = 'modelRegistryMappings'

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const values = value.flatMap(item => readString(item) ?? [])
  return values.length > 0 ? values : undefined
}

function readCost(value: unknown): ModelsDevModel['cost'] | undefined {
  const obj = readObject(value)
  if (!obj) {
    return undefined
  }
  const cost = {
    input: readNumber(obj.input),
    output: readNumber(obj.output),
    cache_read: readNumber(obj.cache_read),
    cache_write: readNumber(obj.cache_write),
  }
  return Object.values(cost).some(item => item !== undefined) ? cost : undefined
}

export function normalizeModelsDevModel(value: unknown): ModelsDevModel | null {
  const obj = readObject(value)
  if (!obj) {
    return null
  }

  const id = readString(obj.id)
  if (!id) {
    return null
  }

  const limitObj = readObject(obj.limit)
  const inputModalities = readStringArray(readObject(obj.modalities)?.input)
  const outputModalities = readStringArray(readObject(obj.modalities)?.output)
  return {
    id,
    ...(readString(obj.name) === undefined ? {} : { name: readString(obj.name) }),
    ...(limitObj === null
      ? {}
      : {
          limit: {
            context: readNumber(limitObj.context),
            output: readNumber(limitObj.output),
          },
        }),
    ...(inputModalities === undefined && outputModalities === undefined
      ? {}
      : {
          modalities: {
            ...(inputModalities === undefined ? {} : { input: inputModalities }),
            ...(outputModalities === undefined ? {} : { output: outputModalities }),
          },
        }),
    ...(readBoolean(obj.reasoning) === undefined ? {} : { reasoning: readBoolean(obj.reasoning) }),
    ...(readBoolean(obj.tool_call) === undefined ? {} : { tool_call: readBoolean(obj.tool_call) }),
    ...(readBoolean(obj.temperature) === undefined ? {} : { temperature: readBoolean(obj.temperature) }),
    ...(readBoolean(obj.structured_output) === undefined ? {} : { structured_output: readBoolean(obj.structured_output) }),
    ...(readCost(obj.cost) === undefined ? {} : { cost: readCost(obj.cost) }),
    ...(readString(obj.family) === undefined ? {} : { family: readString(obj.family) }),
    ...(readString(obj.knowledge) === undefined ? {} : { knowledge: readString(obj.knowledge) }),
    ...(readString(obj.release_date) === undefined ? {} : { release_date: readString(obj.release_date) }),
  }
}

export function normalizeModelRegistryMapping(value: unknown): ModelRegistryMappingEntry | null {
  const obj = readObject(value)
  if (!obj) {
    return null
  }

  const modelId = readString(obj.modelId)
  if (!modelId) {
    return null
  }

  const registryModelId = readString(obj.registryModelId)
  const model = normalizeModelsDevModel(obj.model)
  if (!registryModelId && !model) {
    return null
  }

  return {
    modelId,
    ...(registryModelId === undefined ? {} : { registryModelId }),
    ...(model === null ? {} : { model }),
    ...(readNumber(obj.updatedAt) === undefined ? {} : { updatedAt: readNumber(obj.updatedAt) }),
  }
}

export function readModelRegistryMappings(config: Record<string, unknown>): ModelRegistryMappingEntry[] {
  const raw = config[MODEL_REGISTRY_MAPPINGS_CONFIG_KEY]
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((item) => {
    const mapping = normalizeModelRegistryMapping(item)
    return mapping ? [mapping] : []
  })
}

export function parseProfileConfig(configJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(configJson) as unknown
    return readObject(parsed) ?? {}
  }
  catch {
    return {}
  }
}

export function serializeProfileConfigWithMapping(
  configJson: string,
  mapping: ModelRegistryMappingEntry,
): { configJson: string, mappings: ModelRegistryMappingEntry[] } {
  const config = parseProfileConfig(configJson)
  const nextMappings = [
    ...readModelRegistryMappings(config).filter(item => item.modelId !== mapping.modelId),
    mapping,
  ].toSorted((a, b) => a.modelId.localeCompare(b.modelId))

  return {
    configJson: JSON.stringify({
      ...config,
      [MODEL_REGISTRY_MAPPINGS_CONFIG_KEY]: nextMappings,
    }),
    mappings: nextMappings,
  }
}
