// Output: Provider-target model settings client helpers for Agent Management.
// Input: Provider target references and model preference payloads.
// Position: Shares Cradle-owned model preference writes across manual profiles and external records.

import { z } from 'zod'

import { ProfileConfigSchema } from '~/features/agent-runtime/profile-config-schema'
import { getServerUrl } from '~/lib/electron'
import type { ModelCapabilities, ProviderTarget } from '~/lib/types'

export interface EditableCustomModel {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export interface ProviderTargetModelSettings {
  providerTargetKind: ProviderTarget['kind']
  providerTargetId: string
  configJson: string
  customModelsJson: string
  modelRegistryMappingsJson: string
}

export const ModelCapabilitiesSchema = z
  .object({
    contextWindow: z.number().optional()
  })
  .passthrough()

export const EditableCustomModelSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().optional(),
    capabilities: ModelCapabilitiesSchema.default({}),
    contextWindow: z.number().optional()
  })
  .transform((item) => ({
    id: item.id,
    label: item.label || item.id,
    capabilities:
      item.capabilities.contextWindow == null && item.contextWindow !== undefined
        ? { ...item.capabilities, contextWindow: item.contextWindow }
        : item.capabilities
  }))

export const CustomModelsJsonSchema = z
  .string()
  .transform((raw) => JSON.parse(raw))
  .pipe(z.array(EditableCustomModelSchema))

export const ProviderTargetModelSettingsSchema = z.object({
  providerTargetKind: z.enum(['manual-profile', 'external-record']),
  providerTargetId: z.string(),
  configJson: z.string(),
  customModelsJson: z.string(),
  modelRegistryMappingsJson: z.string()
})

export function providerTargetPath(target: ProviderTarget): string {
  return `${encodeURIComponent(target.kind)}/${encodeURIComponent(target.id)}`
}

export function enabledModelsFromConfig(configJson: string): string[] {
  return ProfileConfigSchema.parse(JSON.parse(configJson)).enabledModels
}

export async function loadProviderTargetModelSettings(
  target: ProviderTarget
): Promise<ProviderTargetModelSettings> {
  const response = await fetch(
    `${getServerUrl()}/provider-targets/${providerTargetPath(target)}/model-settings`
  )
  if (!response.ok) {
    throw new Error('Failed to load provider target model settings')
  }
  return ProviderTargetModelSettingsSchema.parse(await response.json())
}

export async function updateProviderTargetModelVisibility(
  target: ProviderTarget,
  enabledModels: string[]
): Promise<ProviderTargetModelSettings> {
  const response = await fetch(
    `${getServerUrl()}/provider-targets/${providerTargetPath(target)}/model-visibility`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledModels })
    }
  )
  if (!response.ok) {
    throw new Error('Failed to update provider target model visibility')
  }
  return ProviderTargetModelSettingsSchema.parse(await response.json())
}

export async function updateProviderTargetCustomModels(
  target: ProviderTarget,
  models: EditableCustomModel[]
): Promise<EditableCustomModel[]> {
  const sanitized = z.array(EditableCustomModelSchema).parse(models)
  const response = await fetch(
    `${getServerUrl()}/provider-targets/${providerTargetPath(target)}/custom-models`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: sanitized.map((model) => ({
          id: model.id,
          label: model.label !== model.id ? model.label : undefined,
          capabilities: model.capabilities
        }))
      })
    }
  )
  if (!response.ok) {
    throw new Error('Failed to update provider target custom models')
  }
  return z.array(EditableCustomModelSchema).parse(await response.json())
}
