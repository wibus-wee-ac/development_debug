import { t } from 'elysia'

const agentSessionStatus = t.Union([
  t.Literal('created'),
  t.Literal('active'),
  t.Literal('completed'),
  t.Literal('stopped'),
  t.Literal('failed'),
])

export const IssueAgentModel = {
  agentActivity: t.Object({
    id: t.String(),
    agentSessionId: t.String(),
    type: t.Union([
      t.Literal('thought'),
      t.Literal('action'),
      t.Literal('response'),
      t.Literal('elicitation'),
      t.Literal('error'),
      t.Literal('prompt'),
    ]),
    content: t.String(),
    signal: t.Nullable(t.String()),
    signalMetadata: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  delegationState: t.Object({
    issueId: t.String(),
    delegated: t.Boolean(),
    agentProfileId: t.Nullable(t.String()),
    agentId: t.Nullable(t.String()),
    agentSessionId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
  }),

  sessionView: t.Object({
    id: t.String(),
    issueId: t.String(),
    agentProfileId: t.String(),
    agentId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
    status: agentSessionStatus,
    isCurrentDelegation: t.Boolean(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  // ── params / body ──

  issueIdParams: t.Object({ id: t.String() }),
  agentSessionIdParams: t.Object({ agentSessionId: t.String() }),

  delegateBody: t.Object({
    agentId: t.String({ minLength: 1 }),
    agentProfileId: t.Optional(t.Nullable(t.String())),
  }),

  continuationBody: t.Object({
    mode: t.Union([t.Literal('queue'), t.Literal('steer')]),
    text: t.String({ minLength: 1 }),
  }),

  continuationResponse: t.Object({
    ok: t.Literal(true),
    chatSessionId: t.String(),
    queueItemId: t.String(),
    mode: t.Union([t.Literal('queue'), t.Literal('steer')]),
  }),

  rerunBody: t.Object({}),
}
