import { t } from 'elysia'

export const ProfilesModel = {
  agentProfile: t.Object({
    id: t.String(),
    name: t.String(),
    providerKind: t.Union([
      t.Literal('acp-chat'),
      t.Literal('cli-tui'),
      t.Literal('openai-compatible'),
      t.Literal('codex'),
      t.Literal('claude-agent'),
      t.Literal('system-agent'),
    ]),
    enabled: t.Boolean(),
    configJson: t.String(),
    credentialRef: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  upsertBody: t.Object({
    name: t.String({ minLength: 1 }),
    providerKind: t.Union([
      t.Literal('openai-compatible'),
      t.Literal('codex'),
      t.Literal('claude-agent'),
      t.Literal('acp-chat'),
      t.Literal('cli-tui'),
      t.Literal('system-agent'),
    ]),
    enabled: t.Boolean(),
    config: t.Record(t.String(), t.Any()),
    credentialRef: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  }),
}
