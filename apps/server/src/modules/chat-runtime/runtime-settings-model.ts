import { t } from 'elysia'

export const runtimeAccessModeSchema = t.Union([
  t.Literal('approval-required'),
  t.Literal('full-access'),
])

export const runtimeInteractionModeSchema = t.Union([
  t.Literal('default'),
  t.Literal('plan'),
])

export const runtimeSettingsSchema = t.Object({
  accessMode: runtimeAccessModeSchema,
  interactionMode: runtimeInteractionModeSchema,
})

export const runtimeSettingsPatchSchema = t.Object({
  accessMode: t.Optional(runtimeAccessModeSchema),
  interactionMode: t.Optional(runtimeInteractionModeSchema),
})
