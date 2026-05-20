import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { SessionAwaitModel } from './model'
import * as Poller from './poller'
import * as SessionAwait from './service'
import { fetchLiveCIStatus, githubCISource } from './sources/github-ci'
import { fetchLiveReviewStatus, githubReviewSource } from './sources/github-review'

export const sessionAwait = new Elysia({
  prefix: '/session-awaits',
  detail: { tags: ['session-await'] },
})
  .onStart(() => {
    Poller.registerSource(githubCISource)
    Poller.registerSource(githubReviewSource)
    Poller.start()
  })
  .onStop(() => { Poller.stop() })
  .post('/', ({ body }) => SessionAwait.register(body), {
    detail: {
      'summary': 'Register a new session await',
      'x-cradle-cli': {
        command: ['session', 'await-create'],
      },
    },
    body: SessionAwaitModel.createBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/:id', ({ params }) => {
    const row = SessionAwait.get(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found' })
    }
    return row
  }, {
    detail: {
      'summary': 'Get session await by ID',
      'x-cradle-cli': {
        command: ['session', 'await-get'],
      },
    },
    params: SessionAwaitModel.idParams,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/', ({ query }) => SessionAwait.listBySession(query.sessionId), {
    detail: {
      'summary': 'List session awaits',
      'x-cradle-cli': {
        command: ['session', 'await-list'],
      },
    },
    query: SessionAwaitModel.listQuery,
    response: { 200: t.Array(SessionAwaitModel.sessionAwait) },
  })
  .post('/:id/cancel', ({ params }) => {
    const row = SessionAwait.cancel(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found or not pending' })
    }
    return row
  }, {
    detail: {
      'summary': 'Cancel a pending session await',
      'x-cradle-cli': {
        command: ['session', 'await-cancel'],
      },
    },
    params: SessionAwaitModel.idParams,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .post('/:id/trigger', async ({ params, body }) => {
    const row = await SessionAwait.trigger({
      awaitId: params.id,
      resumeText: body.resumeText,
      resumePayloadJson: body.resumePayloadJson,
    })
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found or not pending' })
    }
    return row
  }, {
    detail: {
      'summary': 'Manually trigger a session await',
      'x-cradle-cli': {
        command: ['session', 'await-trigger'],
      },
    },
    params: SessionAwaitModel.idParams,
    body: SessionAwaitModel.triggerBody,
    response: { 200: SessionAwaitModel.sessionAwait },
  })
  .get('/summary', ({ query }) => SessionAwait.getSessionSummary(query.sessionId), {
    detail: {
      'summary': 'Get await summary for a session',
      'x-cradle-cli': {
        command: ['session', 'await-summary'],
      },
    },
    query: SessionAwaitModel.summaryQuery,
    response: { 200: SessionAwaitModel.summary },
  })
  .get('/:id/live-status', async ({ params }) => {
    const row = SessionAwait.get(params.id)
    if (!row) {
      throw new AppError({ code: 'session_await_not_found', status: 404, message: 'Session await not found' })
    }
    if (row.source === 'github-ci') {
      const status = await fetchLiveCIStatus(row.filterJson)
      return status ? { supported: true as const, ...status } : { supported: false as const }
    }
    if (row.source === 'github-review') {
      const status = await fetchLiveReviewStatus(row.filterJson)
      return status ? { supported: true as const, ...status } : { supported: false as const }
    }
    return { supported: false as const }
  }, {
    detail: {
      summary: 'Get live status for a session await',
    },
    params: SessionAwaitModel.idParams,
  })
