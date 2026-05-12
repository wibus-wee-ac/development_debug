import { t } from 'elysia'

const nullableRef = t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))

const openaiCompatibleConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  maxMessages: t.Optional(t.Number()),
})

const codexConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  apiKey: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  approvalPolicy: t.Optional(t.Union([
    t.Literal('never'),
    t.Literal('on-request'),
    t.Literal('on-failure'),
    t.Literal('untrusted'),
  ])),
  sandboxMode: t.Optional(t.Union([
    t.Literal('read-only'),
    t.Literal('workspace-write'),
    t.Literal('danger-full-access'),
  ])),
  reasoningEffort: t.Optional(t.Union([
    t.Literal('minimal'),
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('xhigh'),
  ])),
})

const claudeAgentConfig = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  apiKey: t.Optional(t.String()),
  enabledModels: t.Optional(t.Array(t.String())),
  permissionMode: t.Optional(t.Union([
    t.Literal('default'),
    t.Literal('acceptEdits'),
    t.Literal('bypassPermissions'),
    t.Literal('plan'),
    t.Literal('dontAsk'),
  ])),
  allowDangerouslySkipPermissions: t.Optional(t.Boolean()),
  skills: t.Optional(t.Union([t.Literal('all'), t.Array(t.String())])),
  tools: t.Optional(t.Array(t.String())),
  disallowedTools: t.Optional(t.Array(t.String())),
  maxTurns: t.Optional(t.Number()),
})

const acpChatConfig = t.Object({
  distributionType: t.Optional(t.Union([t.Literal('binary'), t.Literal('npx'), t.Literal('uvx')])),
  installPath: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  cmd: t.Optional(t.String({ minLength: 1 })),
  packageName: t.Optional(t.String({ minLength: 1 })),
  args: t.Optional(t.Array(t.String())),
  env: t.Optional(t.Record(t.String(), t.String())),
})

const cliTuiConfig = t.Object({
  executable: t.Optional(t.String({ minLength: 1 })),
  args: t.Optional(t.Array(t.String())),
  env: t.Optional(t.Record(t.String(), t.String())),
})

export const ProvidersModel = {
  providerBody: t.Union([
    t.Object({
      providerKind: t.Literal('openai-compatible'),
      label: t.String({ minLength: 1 }),
      config: openaiCompatibleConfig,
      secretRef: nullableRef,
      profileId: nullableRef,
    }),
    t.Object({
      providerKind: t.Literal('codex'),
      label: t.String({ minLength: 1 }),
      config: codexConfig,
      secretRef: nullableRef,
      profileId: nullableRef,
    }),
    t.Object({
      providerKind: t.Literal('claude-agent'),
      label: t.String({ minLength: 1 }),
      config: claudeAgentConfig,
      secretRef: nullableRef,
      profileId: nullableRef,
    }),
    t.Object({
      providerKind: t.Literal('acp-chat'),
      label: t.String({ minLength: 1 }),
      config: acpChatConfig,
      secretRef: nullableRef,
      profileId: nullableRef,
    }),
    t.Object({
      providerKind: t.Literal('cli-tui'),
      label: t.String({ minLength: 1 }),
      config: cliTuiConfig,
      secretRef: nullableRef,
      profileId: nullableRef,
    }),
  ]),

  modelDescriptor: t.Object({
    id: t.String(),
    label: t.String(),
    providerKind: t.String(),
    contextWindow: t.Union([t.Number(), t.Null()]),
  }),

  healthCheckResult: t.Object({
    ok: t.Boolean(),
    label: t.String(),
    version: t.Union([t.String(), t.Null()]),
    details: t.Record(t.String(), t.Unknown()),
    errorText: t.Union([t.String(), t.Null()]),
  }),
}
