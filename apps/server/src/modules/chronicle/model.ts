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
    lastSummaryAt: t.Nullable(t.Number()),
    totalSummaries: t.Number(),
    configuredModel: t.Nullable(t.String()),
  }),
}
