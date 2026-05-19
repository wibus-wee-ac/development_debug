// Input: Chronicle API contract definitions
// Output: validated request/response schemas
// Position: apps/server/src/modules/chronicle/model.ts

import { t } from 'elysia'

export const ChronicleModel = {
  config: t.Object({
    profileId: t.String(),
    modelId: t.String(),
    workspaceId: t.String(),
    enabled: t.Boolean(),
    storageRoot: t.String(),
  }),

  timelineEntry: t.Object({
    id: t.String(),
    capturedAt: t.String(),
    displayId: t.Number(),
    segmentDir: t.String(),
    framePath: t.String(),
    ocrText: t.Nullable(t.String()),
  }),

  memoryEntry: t.Object({
    id: t.String(),
    type: t.Union([t.Literal('10min'), t.Literal('6h')]),
    createdAt: t.String(),
    content: t.String(),
  }),

  summarizeBody: t.Object({
    prompt: t.String({ minLength: 1 }),
    windowType: t.Union([t.Literal('10min'), t.Literal('6h')]),
  }),

  summarizeResponse: t.Object({
    summary: t.String(),
  }),

  status: t.Object({
    available: t.Boolean(),
    running: t.Boolean(),
    pid: t.Nullable(t.Number()),
    lastSummaryAt: t.Nullable(t.Number()),
    lastExitCode: t.Nullable(t.Number()),
    lastExitAt: t.Nullable(t.Number()),
    totalSummaries: t.Number(),
    configuredModel: t.Nullable(t.String()),
  }),
}
