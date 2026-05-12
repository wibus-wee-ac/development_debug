import { t } from 'elysia'

const thinkingEffortEnum = t.Union([
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('auto'),
])

export const AgentIdentityModel = {
  agent: t.Object({
    id: t.String(),
    name: t.String(),
    description: t.Nullable(t.String()),
    avatarUrl: t.Nullable(t.String()),
    avatarStyle: t.String(),
    avatarSeed: t.String(),
    agentProfileId: t.String(),
    modelId: t.Nullable(t.String()),
    thinkingEffort: thinkingEffortEnum,
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
    agentProfileId: t.String({ minLength: 1 }),
    modelId: t.Optional(t.Nullable(t.String())),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    configJson: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    avatarStyle: t.Optional(t.String({ minLength: 1 })),
    avatarSeed: t.Optional(t.String({ minLength: 1 })),
    agentProfileId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(t.Nullable(t.String())),
    thinkingEffort: t.Optional(thinkingEffortEnum),
    configJson: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
  }),
}
