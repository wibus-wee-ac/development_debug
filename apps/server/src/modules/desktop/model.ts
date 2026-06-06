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
  state: t.Union([
    t.Literal('running'),
    t.Literal('awaiting'),
    t.Literal('pinned'),
    t.Literal('recent'),
  ]),
  detail: t.String(),
})

const trayHealthItem = t.Object({
  id: t.String(),
  label: t.String(),
  value: t.String(),
  status: t.Union([
    t.Literal('ok'),
    t.Literal('active'),
    t.Literal('warning'),
    t.Literal('danger'),
    t.Literal('unknown'),
  ]),
  detail: t.Nullable(t.String()),
})

const trayCounts = t.Object({
  generatedAt: t.Number(),
  running: t.Number(),
  recentSessions: t.Number(),
  pinnedSessions: t.Number(),
  pendingAwaits: t.Number(),
  enabledAutomations: t.Number(),
  runningAutomations: t.Number(),
  workspaces: t.Number(),
  enabledProviders: t.Number(),
  totalProviders: t.Number(),
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
  trayCounts,
  trayHealth: t.Array(trayHealthItem),
  trayRecentSessions: t.Array(traySessionItem),
  trayAwaits: t.Array(trayAwaitItem),
} as const
