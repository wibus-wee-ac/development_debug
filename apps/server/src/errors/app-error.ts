// Input: error code + status
// Output: typed application error
// Position: server error utilities

import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  readonly code: string
  readonly status: ContentfulStatusCode
  readonly details?: Record<string, unknown>

  constructor(options: {
    code: string
    status: ContentfulStatusCode
    message: string
    details?: Record<string, unknown>
  }) {
    super(options.message)
    this.code = options.code
    this.status = options.status
    this.details = options.details
  }
}
