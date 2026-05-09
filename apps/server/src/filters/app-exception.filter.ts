// Input: thrown errors + HttpContext
// Output: normalized error response
// Position: server exception filter

import { HttpContext, type ArgumentsHost, type ExceptionFilter } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

import { AppError } from '../errors/app-error'
import { Logger } from '../logging/logger'
import { REQUEST_ID_HEADER } from '../middlewares/request-context'

@injectable()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.getContext().hono
    let requestId: string | undefined

    try {
      requestId = HttpContext.get().requestId
    }
    catch {
      requestId = undefined
    }

    if (!requestId) {
      requestId = ctx.req.header(REQUEST_ID_HEADER) ?? undefined
    }

    if (exception instanceof AppError) {
      return ctx.json(
        {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
        exception.status,
      )
    }

    const error = exception instanceof Error ? exception : new Error('Internal server error')
    this.logger.error('Unhandled error', {
      requestId,
      message: error.message,
      stack: error.stack,
      error: exception,
    })

    return ctx.json(
      {
        code: 'internal_error',
        message: 'Internal server error',
        requestId,
      },
      500,
    )
  }
}
