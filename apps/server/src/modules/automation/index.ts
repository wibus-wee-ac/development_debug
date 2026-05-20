// Input: Automation service and TypeBox schemas
// Output: Elysia routes for Agent-authored automation APIs
// Position: Automation module HTTP route owner

import { Elysia, t } from 'elysia'

import { AutomationModel } from './model'
import * as AutomationPoller from './poller'
import * as Automation from './service'

export const automation = new Elysia({
  prefix: '/automations',
  detail: { tags: ['automation'] },
})
  .onStart(() => { AutomationPoller.start() })
  .onStop(() => { AutomationPoller.stop() })
  .post('/', ({ body }) => Automation.create(body), {
    detail: {
      'summary': 'Create automation',
      'x-cradle-cli': { command: ['automation', 'create'] },
    },
    body: AutomationModel.createBody,
    response: { 200: AutomationModel.definition },
  })
  .get('/', ({ query }) => Automation.list(query), {
    detail: {
      'summary': 'List automations',
      'x-cradle-cli': { command: ['automation', 'list'] },
    },
    query: AutomationModel.listQuery,
    response: { 200: t.Array(AutomationModel.definition) },
  })
  .get('/:id', ({ params }) => Automation.get(params.id), {
    detail: {
      'summary': 'Get automation',
      'x-cradle-cli': { command: ['automation', 'get'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .patch('/:id', ({ params, body }) => Automation.update(params.id, body), {
    detail: {
      'summary': 'Update automation',
      'x-cradle-cli': { command: ['automation', 'update'] },
    },
    params: AutomationModel.idParams,
    body: AutomationModel.updateBody,
    response: { 200: AutomationModel.definition },
  })
  .delete('/:id', ({ params }) => {
    Automation.remove(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete automation',
      'x-cradle-cli': { command: ['automation', 'delete'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.ok },
  })
  .post('/:id/enable', ({ params }) => Automation.setEnabled(params.id, true), {
    detail: {
      'summary': 'Enable automation',
      'x-cradle-cli': { command: ['automation', 'enable'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .post('/:id/disable', ({ params }) => Automation.setEnabled(params.id, false), {
    detail: {
      'summary': 'Disable automation',
      'x-cradle-cli': { command: ['automation', 'disable'] },
    },
    params: AutomationModel.idParams,
    response: { 200: AutomationModel.definition },
  })
  .post('/:id/run', ({ params, body }) => Automation.runNow(params.id, body), {
    detail: {
      'summary': 'Run automation now',
      'x-cradle-cli': { command: ['automation', 'run'] },
    },
    params: AutomationModel.idParams,
    body: AutomationModel.runNowBody,
    response: { 200: AutomationModel.run },
  })
  .get('/:id/runs', ({ params }) => Automation.listRuns(params.id), {
    detail: {
      'summary': 'List automation runs',
      'x-cradle-cli': { command: ['automation', 'runs'] },
    },
    params: AutomationModel.idParams,
    response: { 200: t.Array(AutomationModel.run) },
  })
  .get('/:id/runs/:runId', ({ params }) => Automation.getRun(params.id, params.runId), {
    detail: {
      'summary': 'Get automation run',
      'x-cradle-cli': { command: ['automation', 'run', 'get'] },
    },
    params: AutomationModel.runIdParams,
    response: { 200: AutomationModel.run },
  })
  .get('/:id/runs/:runId/artifacts', ({ params }) => Automation.listArtifacts(params.id, params.runId), {
    detail: {
      'summary': 'List automation run artifacts',
      'x-cradle-cli': { command: ['automation', 'artifacts'] },
    },
    params: AutomationModel.runIdParams,
    response: { 200: t.Array(AutomationModel.artifact) },
  })
  .get('/:id/artifacts', ({ params }) => Automation.listArtifacts(params.id), {
    detail: {
      'summary': 'List automation artifacts',
      'x-cradle-cli': { command: ['automation', 'artifact', 'list'] },
    },
    params: AutomationModel.idParams,
    response: { 200: t.Array(AutomationModel.artifact) },
  })
  .get('/:id/artifacts/:artifactId', ({ params }) => Automation.getArtifact(params.id, params.artifactId), {
    detail: {
      'summary': 'Get automation artifact',
      'x-cradle-cli': { command: ['automation', 'artifact', 'get'] },
    },
    params: AutomationModel.artifactIdParams,
    response: { 200: AutomationModel.artifact },
  })
