import { TypeCompiler } from '@sinclair/typebox/compiler'
import type { Static } from 'elysia'
import { t } from 'elysia'

export const PreferencesModel = {
  chatPreferences: t.Object({
    modelId: t.Nullable(t.String()),
    configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
  }, { additionalProperties: false }),
  jarvisPreferences: t.Object({
    profileId: t.Nullable(t.String({ description: 'ID of the agent profile to use for Jarvis' })),
    model: t.Optional(t.String({ description: 'Model ID override for Jarvis (e.g. gpt-4o, claude-3-7-sonnet)' })),
    thinkingLevel: t.Union([
      t.Literal('minimal'),
      t.Literal('low'),
      t.Literal('medium'),
      t.Literal('high'),
      t.Literal('xhigh'),
    ], { default: 'medium' }),
  }, { additionalProperties: false }),
  savedResponse: t.Object({
    ok: t.Literal(true),
  }),
} as const

export const defaultChatPreferences: Static<typeof PreferencesModel['chatPreferences']> = {
  modelId: null,
  configSelections: {},
}

export const defaultJarvisPreferences: Static<typeof PreferencesModel['jarvisPreferences']> = {
  profileId: null,
  model: undefined,
  thinkingLevel: 'medium',
}

const chatPreferencesValidator = TypeCompiler.Compile(PreferencesModel.chatPreferences)
const jarvisPreferencesValidator = TypeCompiler.Compile(PreferencesModel.jarvisPreferences)

export function parseChatPreferences(value: unknown):
  | { success: true, data: Static<typeof PreferencesModel['chatPreferences']> }
  | { success: false, issues: Array<{ path: string, message: string }> } {
  if (chatPreferencesValidator.Check(value)) {
    return { success: true, data: value }
  }
  return {
    success: false,
    issues: Array.from(chatPreferencesValidator.Errors(value), issue => ({
      path: normalizeTypeBoxPath(issue.path),
      message: issue.message,
    })),
  }
}

export function parseJarvisPreferences(value: unknown):
  | { success: true, data: Static<typeof PreferencesModel['jarvisPreferences']> }
  | { success: false, issues: Array<{ path: string, message: string }> } {
  if (jarvisPreferencesValidator.Check(value)) {
    return { success: true, data: value }
  }
  return {
    success: false,
    issues: Array.from(jarvisPreferencesValidator.Errors(value), issue => ({
      path: normalizeTypeBoxPath(issue.path),
      message: issue.message,
    })),
  }
}

const RE_LEADING_SLASHES = /^\/+/
const RE_SLASH = /\//g

function normalizeTypeBoxPath(path: string | undefined): string {
  if (!path || path === '/' || path === 'root') {
    return 'root'
  }
  const normalized = path.replace(RE_LEADING_SLASHES, '').replace(RE_SLASH, '.')
  return normalized.length > 0 ? normalized : 'root'
}
