import type {
  ChatRuntimeAccessMode,
  ChatRuntimeInteractionMode,
  ChatRuntimeSettings,
  ChatRuntimeSettingsPatch,
} from './runtime-provider-types'
import { parseJsonObject, readObjectRecord } from '../../helpers/json-record'

export const DEFAULT_RUNTIME_SETTINGS: ChatRuntimeSettings = {
  accessMode: 'full-access',
  interactionMode: 'default',
}

export function normalizeRuntimeAccessMode(value: unknown): ChatRuntimeAccessMode | null {
  return value === 'approval-required' || value === 'full-access' ? value : null
}

export function normalizeRuntimeInteractionMode(value: unknown): ChatRuntimeInteractionMode | null {
  return value === 'default' || value === 'plan' ? value : null
}

function readRuntimeSettingsRecord(value: unknown): ChatRuntimeSettingsPatch {
  const record = readObjectRecord(value)
  return {
    ...(normalizeRuntimeAccessMode(record.accessMode) ? { accessMode: normalizeRuntimeAccessMode(record.accessMode)! } : {}),
    ...(normalizeRuntimeInteractionMode(record.interactionMode) ? { interactionMode: normalizeRuntimeInteractionMode(record.interactionMode)! } : {}),
  }
}

export function normalizeRuntimeSettingsPatch(value: unknown): ChatRuntimeSettingsPatch {
  return readRuntimeSettingsRecord(value)
}

export function mergeRuntimeSettings(
  base: ChatRuntimeSettings,
  patch?: ChatRuntimeSettingsPatch | null,
): ChatRuntimeSettings {
  return {
    accessMode: patch?.accessMode ?? base.accessMode,
    interactionMode: patch?.interactionMode ?? base.interactionMode,
  }
}

export function areRuntimeSettingsEqual(left: ChatRuntimeSettings, right: ChatRuntimeSettings): boolean {
  return left.accessMode === right.accessMode && left.interactionMode === right.interactionMode
}

export function readSessionRuntimeSettings(configJson: string | null | undefined): ChatRuntimeSettings {
  const config = parseJsonObject(configJson ?? '{}')
  return mergeRuntimeSettings(DEFAULT_RUNTIME_SETTINGS, readRuntimeSettingsRecord(config.runtimeSettings))
}

export function writeSessionRuntimeSettingsConfigJson(
  configJson: string | null | undefined,
  settings: ChatRuntimeSettings,
): string {
  const config = parseJsonObject(configJson ?? '{}')
  return JSON.stringify({
    ...config,
    runtimeSettings: settings,
  })
}
