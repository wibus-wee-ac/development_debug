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
    agentSessionId: t.Nullable(t.String()),
    chatSessionId: t.Nullable(t.String()),
  }),

  sessionView: t.Object({
    id: t.String(),
    issueId: t.String(),
    agentProfileId: t.String(),
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
    agentProfileId: t.String(),
    agentId: t.Optional(t.String()),
  }),

  rerunBody: t.Object({
    agentId: t.Optional(t.String()),
  }),
}
