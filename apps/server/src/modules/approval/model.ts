import { t } from 'elysia'

const approvalOption = t.Object({
  optionId: t.String({ minLength: 1 }),
  label: t.String({ minLength: 1 }),
  description: t.Optional(t.String({ minLength: 1 })),
})

export const ApprovalModel = {
  pendingApproval: t.Object({
    id: t.String(),
    chatSessionId: t.Nullable(t.String()),
    agentId: t.String(),
    prompt: t.String(),
    options: t.Array(approvalOption),
    createdAt: t.Number(),
  }),

  idParams: t.Object({
    approvalId: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    chatSessionId: t.Optional(t.String()),
  }),

  createBody: t.Object({
    chatSessionId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    agentId: t.String({ minLength: 1 }),
    prompt: t.String({ minLength: 1 }),
    options: t.Array(approvalOption, { minItems: 1 }),
  }),

  respondBody: t.Object({
    decision: t.Union([t.Literal('approved'), t.Literal('rejected')]),
    selectedOptionId: t.String({ minLength: 1 }),
  }),
}
