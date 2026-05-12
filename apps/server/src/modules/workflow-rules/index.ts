import { Elysia, t } from 'elysia'

import { WorkflowRulesModel } from './model'
import * as WorkflowRules from './service'

export const workflowRules = new Elysia({
  prefix: '/workflow-rules',
  detail: { tags: ['workflow-rules'] },
})
  .get('/:workspaceId/list', ({ params }) => WorkflowRules.list(params.workspaceId), {
    detail: { summary: 'List workflow rules' },
    params: WorkflowRulesModel.workspaceIdParams,
    response: { 200: t.Array(WorkflowRulesModel.workflowRuleEntry) },
  })
  .get('/:workspaceId', ({ params, query }) => WorkflowRules.get(params.workspaceId, query.agentProfileId), {
    detail: { summary: 'Get workflow rules' },
    params: WorkflowRulesModel.workspaceIdParams,
    query: WorkflowRulesModel.getQuery,
    response: { 200: WorkflowRulesModel.workflowRules },
  })
  .put('/:workspaceId', async ({ params, body }) => {
    await WorkflowRules.save(params.workspaceId, body.agentProfileId ?? null, body.content)
    return { ok: true as const }
  }, {
    detail: { summary: 'Save workflow rule' },
    params: WorkflowRulesModel.workspaceIdParams,
    body: WorkflowRulesModel.saveBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .delete('/:workspaceId', async ({ params, query }) => {
    await WorkflowRules.remove(params.workspaceId, query.agentProfileId ?? null)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete workflow rule' },
    params: WorkflowRulesModel.workspaceIdParams,
    query: WorkflowRulesModel.deleteQuery,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
