import { TypeCompiler } from '@sinclair/typebox/compiler'
import type { Static } from 'elysia'
import { t } from 'elysia'

export const PreferencesModel = {
  chatPreferences: t.Object({
    modelId: t.Nullable(t.String()),
    configSelections: t.Record(t.String(), t.Union([t.String(), t.Boolean()])),
  }, { additionalProperties: false }),
  savedResponse: t.Object({
    ok: t.Literal(true),
  }),
} as const

export const defaultChatPreferences: Static<typeof PreferencesModel['chatPreferences']> = {
  modelId: null,
  configSelections: {},
}

const chatPreferencesValidator = TypeCompiler.Compile(PreferencesModel.chatPreferences)

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

const RE_LEADING_SLASHES = /^\/+/
const RE_SLASH = /\//g

function normalizeTypeBoxPath(path: string | undefined): string {
  if (!path || path === '/' || path === 'root') {
    return 'root'
  }
  const normalized = path.replace(RE_LEADING_SLASHES, '').replace(RE_SLASH, '.')
  return normalized.length > 0 ? normalized : 'root'
}
