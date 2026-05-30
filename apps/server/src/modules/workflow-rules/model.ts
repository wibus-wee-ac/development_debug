import { t } from 'elysia'

const nullableString = t.Unsafe<string | null>({ type: 'string', nullable: true })

export const WorkflowRulesModel = {
  workflowRuleEntry: t.Object({
    type: t.Union([t.Literal('global'), t.Literal('agent')]),
    agentProfileId: nullableString,
    content: t.String(),
  }),

  workflowRules: t.Object({
    global: nullableString,
    profileSpecific: nullableString,
  }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  getQuery: t.Object({
    agentProfileId: t.Optional(t.String()),
  }),

  saveBody: t.Object({
    agentProfileId: t.Optional(nullableString),
    content: t.String(),
  }),

  deleteQuery: t.Object({
    agentProfileId: t.Optional(t.String()),
  }),
}
