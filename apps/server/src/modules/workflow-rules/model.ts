import { t } from 'elysia'

export const WorkflowRulesModel = {
  workflowRuleEntry: t.Object({
    type: t.Union([t.Literal('global'), t.Literal('agent')]),
    agentProfileId: t.Nullable(t.String()),
    content: t.String(),
  }),

  workflowRules: t.Object({
    global: t.Nullable(t.String()),
    profileSpecific: t.Nullable(t.String()),
  }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  getQuery: t.Object({
    agentProfileId: t.Optional(t.String()),
  }),

  saveBody: t.Object({
    agentProfileId: t.Optional(t.Nullable(t.String())),
    content: t.String(),
  }),

  deleteQuery: t.Object({
    agentProfileId: t.Optional(t.String()),
  }),
}
