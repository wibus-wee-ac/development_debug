import { z } from 'zod'

import type { ModelRegistryMappingEntry, ModelsDevModel } from './model-info-registry'

export const MODEL_REGISTRY_MAPPINGS_CONFIG_KEY = 'modelRegistryMappings'

const nonEmptyTrimmedString = z.string().trim().min(1)
const finiteNumber = z.number().finite()

export const ModelsDevModelSchema: z.ZodType<ModelsDevModel> = z.object({
  id: nonEmptyTrimmedString,
  name: nonEmptyTrimmedString.optional(),
  limit: z.object({
    context: finiteNumber.optional(),
    output: finiteNumber.optional(),
  }).optional(),
  modalities: z.object({
    input: z.array(nonEmptyTrimmedString).optional(),
    output: z.array(nonEmptyTrimmedString).optional(),
  }).optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structured_output: z.boolean().optional(),
  cost: z.object({
    input: finiteNumber.optional(),
    output: finiteNumber.optional(),
    cache_read: finiteNumber.optional(),
    cache_write: finiteNumber.optional(),
  }).optional(),
  family: nonEmptyTrimmedString.optional(),
  knowledge: nonEmptyTrimmedString.optional(),
  release_date: nonEmptyTrimmedString.optional(),
})

export const ModelRegistryMappingEntrySchema: z.ZodType<ModelRegistryMappingEntry> = z.object({
  modelId: nonEmptyTrimmedString,
  registryModelId: nonEmptyTrimmedString.optional(),
  model: ModelsDevModelSchema.optional(),
  updatedAt: finiteNumber.optional(),
})

export const ProfileConfigWithModelRegistrySchema = z.object({
  [MODEL_REGISTRY_MAPPINGS_CONFIG_KEY]: z.array(ModelRegistryMappingEntrySchema).default([]),
}).catchall(z.unknown())

export const ProfileConfigWithModelRegistryJsonSchema = z.preprocess(
  raw => JSON.parse(raw as string),
  ProfileConfigWithModelRegistrySchema,
)

export function serializeProfileConfigWithMapping(
  configJson: string,
  mapping: ModelRegistryMappingEntry,
): { configJson: string, mappings: ModelRegistryMappingEntry[] } {
  const config = ProfileConfigWithModelRegistryJsonSchema.parse(configJson)
  const nextMappings = [
    ...config.modelRegistryMappings.filter(item => item.modelId !== mapping.modelId),
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
