/* Defines the NDJSON protocol shared by Electron main and Cradle Mac Bridge. */
import { z } from 'zod'

export const MacBridgeErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

export const MacBridgeResponseSchema = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: MacBridgeErrorSchema.optional(),
})

export const MacBridgeEventSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
})

export const MacBridgeStatusSchema = z.object({
  name: z.literal('cradle-mac-bridge'),
  version: z.string(),
  pid: z.number().int().positive(),
  platform: z.string(),
})

export const MacPermissionStateSchema = z.enum([
  'granted',
  'denied',
  'notDetermined',
  'unsupported',
  'unknown',
])

export const MacPermissionsStatusSchema = z.object({
  accessibility: MacPermissionStateSchema,
  screenRecording: MacPermissionStateSchema,
  inputMonitoring: MacPermissionStateSchema,
})

export const MacPermissionKindSchema = z.enum([
  'accessibility',
  'screenRecording',
  'inputMonitoring',
])

export const MacPermissionsRequestSchema = z.object({
  permissions: z.array(MacPermissionKindSchema).optional(),
})

export const MacPermissionsRequestResultSchema = z.object({
  requested: z.array(MacPermissionKindSchema),
  status: MacPermissionsStatusSchema,
})

export const MacPermissionSettingsTargetSchema = z.enum([
  'privacy',
  'accessibility',
  'screenRecording',
  'inputMonitoring',
])

export const MacPermissionSettingsRequestSchema = z.object({
  target: MacPermissionSettingsTargetSchema.optional(),
})

export const MacPermissionSettingsResultSchema = z.object({
  target: MacPermissionSettingsTargetSchema,
  url: z.string(),
  opened: z.boolean(),
})

export const MacInputConfigureRequestSchema = z.object({
  trigger: z.literal('bothCommand'),
  enabled: z.boolean(),
})

export const MacInputConfigureResultSchema = z.object({
  trigger: z.literal('bothCommand'),
  enabled: z.boolean(),
})

export const MacCaptureFrontmostWindowRequestSchema = z.object({
  outputDir: z.string().min(1),
  privacySensitiveAppBundleIds: z.array(z.string()).optional(),
  privacySensitiveTitlePatterns: z.array(z.string()).optional(),
})

export const MacCapturedWindowSchema = z.object({
  windowId: z.number().int().nonnegative(),
  appName: z.string().nullable(),
  bundleId: z.string().nullable(),
  processId: z.number().int().nonnegative(),
  title: z.string().nullable(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).nullable(),
})

export const MacCaptureFrontmostWindowResultSchema = z.object({
  filePath: z.string(),
  metadataPath: z.string(),
  capturedAt: z.string(),
  window: MacCapturedWindowSchema,
})

export const MacHotkeyTriggeredEventSchema = z.object({
  trigger: z.literal('bothCommand'),
  capturedAt: z.string(),
})

export type MacBridgeError = z.infer<typeof MacBridgeErrorSchema>
export type MacBridgeStatus = z.infer<typeof MacBridgeStatusSchema>
export type MacPermissionKind = z.infer<typeof MacPermissionKindSchema>
export type MacPermissionsStatus = z.infer<typeof MacPermissionsStatusSchema>
export type MacPermissionsRequest = z.infer<typeof MacPermissionsRequestSchema>
export type MacPermissionsRequestResult = z.infer<typeof MacPermissionsRequestResultSchema>
export type MacPermissionSettingsTarget = z.infer<typeof MacPermissionSettingsTargetSchema>
export type MacPermissionSettingsRequest = z.infer<typeof MacPermissionSettingsRequestSchema>
export type MacPermissionSettingsResult = z.infer<typeof MacPermissionSettingsResultSchema>
export type MacInputConfigureRequest = z.infer<typeof MacInputConfigureRequestSchema>
export type MacInputConfigureResult = z.infer<typeof MacInputConfigureResultSchema>
export type MacCaptureFrontmostWindowRequest = z.infer<typeof MacCaptureFrontmostWindowRequestSchema>
export type MacCaptureFrontmostWindowResult = z.infer<typeof MacCaptureFrontmostWindowResultSchema>
export type MacHotkeyTriggeredEvent = z.infer<typeof MacHotkeyTriggeredEventSchema>

export interface MacBridgeRuntimeStatus {
  available: boolean
  running: boolean
  platform: NodeJS.Platform
  binaryPath: string | null
  pid: number | null
  startedAt: string | null
  lastError: string | null
}
