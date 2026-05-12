import { Elysia, t } from 'elysia'

import { IssueAgentModel } from './model'
import * as IssueAgent from './service'

export const issueAgent = new Elysia({
  detail: { tags: ['issue-agent'] },
})

  // ── kanban issue delegation ──

  .get('/kanban/issues/:id/delegation', ({ params }) =>
    IssueAgent.getDelegation(params.id), {
    detail: { summary: 'Get delegation state' },
    params: IssueAgentModel.issueIdParams,
    response: { 200: IssueAgentModel.delegationState },
  })

  .post('/kanban/issues/:id/delegation', ({ params, body }) =>
    IssueAgent.delegateIssue({
      issueId: params.id,
      agentProfileId: body.agentProfileId,
      agentId: body.agentId,
    }), {
    detail: { summary: 'Delegate issue' },
    params: IssueAgentModel.issueIdParams,
    body: IssueAgentModel.delegateBody,
    response: { 200: IssueAgentModel.sessionView },
  })

  .delete('/kanban/issues/:id/delegation', async ({ params }) => {
    await IssueAgent.undelegateIssue(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Undelegate issue' },
    params: IssueAgentModel.issueIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  .get('/kanban/issues/:id/agent-sessions', ({ params }) =>
    IssueAgent.listSessions(params.id), {
    detail: { summary: 'List agent sessions' },
    params: IssueAgentModel.issueIdParams,
    response: { 200: t.Array(IssueAgentModel.sessionView) },
  })

  // ── agent sessions ──

  .get('/issue-agent-sessions/:agentSessionId/activities', ({ params }) =>
    IssueAgent.listActivities(params.agentSessionId), {
    detail: { summary: 'List activities' },
    params: IssueAgentModel.agentSessionIdParams,
    response: { 200: t.Array(IssueAgentModel.agentActivity) },
  })

  .post('/issue-agent-sessions/:agentSessionId/rerun', ({ params, body }) =>
    IssueAgent.rerunSession({
      agentSessionId: params.agentSessionId,
      agentId: body?.agentId,
    }), {
    detail: { summary: 'Rerun session' },
    params: IssueAgentModel.agentSessionIdParams,
    body: t.Optional(IssueAgentModel.rerunBody),
    response: { 200: IssueAgentModel.sessionView },
  })

  .delete('/issue-agent-sessions/:agentSessionId', async ({ params }) => {
    await IssueAgent.stopSession(params.agentSessionId)
    return { ok: true as const }
  }, {
    detail: { summary: 'Stop agent session' },
    params: IssueAgentModel.agentSessionIdParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
