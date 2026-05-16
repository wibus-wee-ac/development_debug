import { t } from 'elysia'

const thinkingEffortEnum = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('auto'),
])

const runtimeKindEnum = t.Union([
  t.Literal('standard'),
  t.Literal('claude-agent'),
  t.Literal('codex'),
  t.Literal('jar-core'),
  t.Literal('acp-chat'),
  t.Literal('cli-tui'),
])

export const AgentIdentityModel = {
  agent: t.Object({
    id: t.String(),
    name: t.String(),
    description: t.Nullable(t.String()),
    avatarUrl: t.Nullable(t.String()),
    avatarStyle: t.String(),
    avatarSeed: t.String(),
    agentProfileId: t.Nullable(t.String()),
    modelId: t.Nullable(t.String()),
    thinkingEffort: thinkingEffortEnum,
    runtimeKind: runtimeKindEnum,
    configJson: t.String(),
    enabled: t.Boolean(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    enabled: t.Optional(t.String()),
    agentProfileId: t.Optional(t.String()),
  }),

  createBody: t.Object({
    name: t.String({ minLength: 1 }),
    description: t.Optional(t.Nullable(t.String())),
    avatarStyle: t.String({ minLength: 1 }),
    avatarSeed: t.String({ minLength: 1 }),
    agentProfileId: t.Optional(t.Nullable(t.String())),
    modelId: t.Optional(t.Nullable(t.String())),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    runtimeKind: t.Optional(runtimeKindEnum),
    configJson: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    avatarStyle: t.Optional(t.String({ minLength: 1 })),
    avatarSeed: t.Optional(t.String({ minLength: 1 })),
    agentProfileId: t.Optional(t.Nullable(t.String())),
    modelId: t.Optional(t.Nullable(t.String())),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    runtimeKind: t.Optional(runtimeKindEnum),
    configJson: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
  }),
}
