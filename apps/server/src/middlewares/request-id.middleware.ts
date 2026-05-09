// Input: Request headers + HttpContext
// Output: requestId injection
// Position: server request middleware

import { randomUUID } from 'node:crypto'

import { HttpContext, Middleware } from '@tsuki-hono/common'
import type { Context, Next } from 'hono'
import { injectable } from 'tsyringe'

import { REQUEST_ID_HEADER } from './request-context'

@Middleware({ path: '/*', priority: -20 })
@injectable()
export class RequestIdMiddleware {
  async use(context: Context, next: Next): Promise<void> {
    const incoming = context.req.header(REQUEST_ID_HEADER)
    const requestId = incoming?.trim() || randomUUID()

    HttpContext.assign({ requestId })
    context.header(REQUEST_ID_HEADER, requestId)

    await next()
  }
}
