import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])
const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const remoteRuntimeHostTransport = t.Union([
  t.Literal('ssh'),
  t.Literal('direct-socket'),
])
const sshAuth = t.Union([
  t.Literal('default'),
  t.Literal('identityFile'),
])
const connectionState = t.Union([
  t.Literal('idle'),
  t.Literal('connecting'),
  t.Literal('connected'),
  t.Literal('disconnected'),
  t.Literal('offline'),
])

const sshProfile = t.Object({
  hostName: nonBlankString,
  user: t.Optional(nullableString),
  port: t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 65_535 }), t.Null()])),
  auth: t.Optional(sshAuth),
  identityFilePath: t.Optional(nullableString),
}, { additionalProperties: false })

const runtimeSummary = t.Object({
  runtimeKind: t.String(),
  label: t.String(),
  status: t.Union([t.Literal('available'), t.Literal('unavailable')]),
  detail: nullableString,
}, { additionalProperties: false })

const workspaceSummary = t.Object({
  id: t.String(),
  name: t.String(),
  path: t.String(),
  reason: t.String(),
}, { additionalProperties: false })

const agentSummary = t.Object({
  agentId: t.String(),
  runtimeKind: t.String(),
  workspacePath: t.String(),
  status: t.Union([t.Literal('idle'), t.Literal('running'), t.Literal('failed')]),
  providerSessionId: nullableString,
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

export const RemoteRuntimeHostsModel = {
  hostIdParams: t.Object({
    hostId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  host: t.Object({
    id: t.String(),
    displayName: t.String(),
    sshTarget: t.String(),
    remoteSocketPath: t.String(),
    enabled: t.Boolean(),
    lastDaemonHostId: nullableString,
    lastDaemonVersion: nullableString,
    lastPlatform: nullableString,
    lastArch: nullableString,
    lastSeenAt: nullableNumber,
    connectionConfigJson: t.String(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    connectionState,
    lastError: nullableString,
  }, { additionalProperties: false }),

  createHostBody: t.Object({
    id: t.Optional(nonBlankString),
    displayName: nonBlankString,
    sshTarget: t.Optional(nonBlankString),
    remoteSocketPath: t.Optional(nonBlankString),
    enabled: t.Optional(t.Boolean()),
    transport: t.Optional(remoteRuntimeHostTransport),
    sshProfile: t.Optional(t.Union([sshProfile, t.Null()])),
    localSocketPath: t.Optional(nonBlankString),
    connectTimeoutMs: t.Optional(t.Integer({ minimum: 1, maximum: 120_000 })),
    connectionConfig: t.Optional(t.Record(t.String(), t.Unknown())),
  }, { additionalProperties: false }),

  updateHostBody: t.Object({
    displayName: t.Optional(nonBlankString),
    sshTarget: t.Optional(nonBlankString),
    remoteSocketPath: t.Optional(nonBlankString),
    enabled: t.Optional(t.Boolean()),
    transport: t.Optional(remoteRuntimeHostTransport),
    sshProfile: t.Optional(t.Union([sshProfile, t.Null()])),
    localSocketPath: t.Optional(nonBlankString),
    connectTimeoutMs: t.Optional(t.Integer({ minimum: 1, maximum: 120_000 })),
    connectionConfig: t.Optional(t.Record(t.String(), t.Unknown())),
  }, { additionalProperties: false }),

  connection: t.Object({
    hostId: t.String(),
    state: connectionState,
    localSocketPath: nullableString,
    daemonHostId: nullableString,
    daemonVersion: nullableString,
    platform: nullableString,
    arch: nullableString,
    lastError: nullableString,
  }, { additionalProperties: false }),

  health: t.Object({
    hostId: t.String(),
    status: t.Union([t.Literal('ok'), t.Literal('offline')]),
    daemonVersion: nullableString,
    daemonHostId: nullableString,
    uptimeSeconds: nullableNumber,
    connectionState,
    lastError: nullableString,
  }, { additionalProperties: false }),

  runtimeList: t.Object({
    runtimes: t.Array(runtimeSummary),
  }, { additionalProperties: false }),

  workspaceQuery: t.Object({
    root: t.Optional(t.String()),
  }, { additionalProperties: false }),

  workspaceList: t.Object({
    workspaces: t.Array(workspaceSummary),
    message: nullableString,
  }, { additionalProperties: false }),

  agentList: t.Object({
    agents: t.Array(agentSummary),
  }, { additionalProperties: false }),

  startAgentBody: t.Object({
    runtimeKind: nonBlankString,
    workspacePath: nonBlankString,
    chatSessionId: t.Optional(nullableString),
    providerSessionId: t.Optional(nullableString),
    modelId: t.Optional(nullableString),
  }, { additionalProperties: false }),

  startAgentResponse: t.Object({
    agent: agentSummary,
  }, { additionalProperties: false }),

  ok: t.Object({
    ok: t.Literal(true),
  }, { additionalProperties: false }),
} as const
