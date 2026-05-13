// Input: thrown AppError or unknown exception
// Output: normalized JSON error responses for the Elysia path
// Position: apps/server/src/http error mapping plugin

import type { ErrorHandler } from 'elysia'
import { Elysia } from 'elysia'

import { AppError } from '../errors/app-error'
import { getLogger } from '../logging/logger'
import { normalizeValidationError } from './validation'

function createJsonErrorResponse(
  headers: Record<string, string | number | undefined>,
  status: number,
  body: Record<string, unknown>,
): Response {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...normalizedHeaders,
      'content-type': 'application/json',
    },
  })
}

export function createErrorHandler(): ErrorHandler {
  return ({ code, error, set }) => {
    if (error instanceof AppError) {
      return createJsonErrorResponse(set.headers, error.status, {
        code: error.code,
        message: error.message,
        details: error.details,
      })
    }

    if (code === 'VALIDATION') {
      const normalized = normalizeValidationError(error, {
        code: 'validation_error',
        message: 'request validation failed',
      })
      return createJsonErrorResponse(set.headers, normalized.status, normalized.body)
    }

    if (code === 'NOT_FOUND') {
      return createJsonErrorResponse(set.headers, 404, {
        code: 'not_found',
        message: 'Not Found',
      })
    }

    getLogger().error('unhandled error', { error })
    return createJsonErrorResponse(set.headers, 500, {
      code: 'internal_server_error',
      message: 'Internal Server Error',
    })
  }
}

export function createErrorMappingPlugin() {
  return new Elysia({ name: 'cradle.http.error-mapping' })
    .as('global')
    .onError(createErrorHandler())
}
