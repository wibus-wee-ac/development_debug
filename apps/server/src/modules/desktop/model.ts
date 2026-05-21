import { t } from 'elysia'

const traySessionItem = t.Object({
  id: t.String(),
  sessionId: t.String(),
  title: t.String(),
  workspaceId: t.Nullable(t.String()),
  workspaceName: t.String(),
  runtimeKind: t.String(),
  modelId: t.Nullable(t.String()),
  updatedAt: t.Number(),
  detail: t.String(),
})

const trayMetric = t.Object({
  id: t.String(),
  label: t.String(),
  value: t.String(),
  tone: t.Union([
    t.Literal('neutral'),
    t.Literal('active'),
    t.Literal('warning'),
    t.Literal('danger'),
  ]),
})

const trayQuickAction = t.Object({
  id: t.String(),
  label: t.String(),
  description: t.String(),
  accelerator: t.Nullable(t.String()),
  badge: t.Nullable(t.String()),
  enabled: t.Boolean(),
})

const trayAwaitItem = t.Object({
  id: t.String(),
  sessionId: t.String(),
  title: t.String(),
  workspaceId: t.Nullable(t.String()),
  workspaceName: t.String(),
  source: t.String(),
  reason: t.Nullable(t.String()),
  createdAt: t.Number(),
})

export const DesktopModel = {
  traySnapshot: t.Object({
    generatedAt: t.Number(),
    running: t.Array(traySessionItem),
    resident: t.Array(traySessionItem),
    metrics: t.Array(trayMetric),
    quickActions: t.Array(trayQuickAction),
  }),
  trayAwaits: t.Array(trayAwaitItem),
} as const
