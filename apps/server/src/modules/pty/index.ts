import { Elysia } from 'elysia'

import { PtyModel } from './model'
import * as Pty from './service'

export const pty = new Elysia({
  prefix: '/terminal-sessions',
  detail: { tags: ['pty'] },
})
  .post('/:sessionId/start-or-attach', ({ params, body }) => {
    return Pty.startOrAttach({ sessionId: params.sessionId, cols: body.cols, rows: body.rows })
  }, {
    detail: { summary: 'Start or attach terminal session' },
    params: PtyModel.sessionIdParams,
    body: PtyModel.startOrAttachBody,
    response: { 200: PtyModel.startOrAttachResponse },
  })
  .get('/:sessionId/stream', ({ params }) => {
    return new Response(Pty.openStream(params.sessionId), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'Stream terminal output via SSE' },
    params: PtyModel.sessionIdParams,
  })
  .post('/:sessionId/input', ({ params, body }) => {
    Pty.writeInput({ sessionId: params.sessionId, data: body.data })
    return { ok: true as const }
  }, {
    detail: { summary: 'Send input to terminal' },
    params: PtyModel.sessionIdParams,
    body: PtyModel.inputBody,
    response: { 200: PtyModel.okResponse },
  })
  .post('/:sessionId/resize', ({ params, body }) => {
    Pty.resize({ sessionId: params.sessionId, cols: body.cols, rows: body.rows })
    return { ok: true as const }
  }, {
    detail: { summary: 'Resize terminal' },
    params: PtyModel.sessionIdParams,
    body: PtyModel.resizeBody,
    response: { 200: PtyModel.okResponse },
  })
  .delete('/:sessionId', ({ params }) => {
    Pty.stop(params.sessionId)
    return { ok: true as const }
  }, {
    detail: { summary: 'Stop terminal session' },
    params: PtyModel.sessionIdParams,
    response: { 200: PtyModel.okResponse },
  })
  .post('/shell/start', ({ body }) => {
    return Pty.startShell({ ptyId: body.ptyId, cwd: body.cwd, cols: body.cols, rows: body.rows })
  }, {
    detail: { summary: 'Start or attach a generic shell' },
    body: PtyModel.startShellBody,
    response: { 200: PtyModel.startOrAttachResponse },
  })
  .get('/shell/:sessionId/stream', ({ params }) => {
    return new Response(Pty.shellStream(params.sessionId), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'Stream shell output via SSE' },
    params: PtyModel.sessionIdParams,
  })
  .post('/shell/:sessionId/input', ({ params, body }) => {
    Pty.shellInput(params.sessionId, body.data)
    return { ok: true as const }
  }, {
    detail: { summary: 'Send input to shell' },
    params: PtyModel.sessionIdParams,
    body: PtyModel.inputBody,
    response: { 200: PtyModel.okResponse },
  })
  .post('/shell/:sessionId/resize', ({ params, body }) => {
    Pty.shellResize(params.sessionId, body.cols, body.rows)
    return { ok: true as const }
  }, {
    detail: { summary: 'Resize shell' },
    params: PtyModel.sessionIdParams,
    body: PtyModel.resizeBody,
    response: { 200: PtyModel.okResponse },
  })
  .delete('/shell/:sessionId', ({ params }) => {
    Pty.shellStop(params.sessionId)
    return { ok: true as const }
  }, {
    detail: { summary: 'Stop shell session' },
    params: PtyModel.sessionIdParams,
    response: { 200: PtyModel.okResponse },
  })
