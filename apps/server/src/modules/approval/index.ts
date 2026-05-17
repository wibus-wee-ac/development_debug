import { Elysia, t } from 'elysia'

import { ApprovalModel } from './model'
import * as Approval from './service'

export const approval = new Elysia({
  prefix: '/approvals',
  detail: { tags: ['approval'] },
})
  .get('/', ({ query }) => {
    const result = Approval.listPending({ chatSessionId: query.chatSessionId })
    return result
  }, {
    detail: {
      'summary': 'List pending approvals',
      'x-cradle-cli': {
        command: ['approval', 'list'],
      },
    },
    query: ApprovalModel.listQuery,
    response: { 200: t.Array(ApprovalModel.pendingApproval) },
  })
  .post('/', ({ body }) => Approval.createPending(body), {
    detail: { summary: 'Create pending approval' },
    body: ApprovalModel.createBody,
    response: { 200: ApprovalModel.pendingApproval },
  })
  .get('/stream', () => {
    let cleanup: (() => void) | undefined

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        // Send existing pending approvals as initial burst
        for (const item of Approval.listPending()) {
          send('approval.requested', item)
        }

        const unsubRequested = Approval.onRequested((approval) => {
          send('approval.requested', approval)
        })
        const unsubResolved = Approval.onResolved((approvalId, response) => {
          send('approval.resolved', { approvalId, ...response })
        })

        // Keep-alive ping every 30s
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          }
          catch {
            clearInterval(pingInterval)
          }
        }, 30_000)

        cleanup = () => {
          unsubRequested()
          unsubResolved()
          clearInterval(pingInterval)
        }
      },
      cancel() {
        cleanup?.()
      },
    })

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'Stream approval events via SSE' },
  })
  .post('/:approvalId/respond', ({ params, body }) => {
    Approval.respond(params.approvalId, body)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Respond to a pending approval',
      'x-cradle-cli': {
        command: ['approval', 'respond'],
      },
    },
    params: ApprovalModel.idParams,
    body: ApprovalModel.respondBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
