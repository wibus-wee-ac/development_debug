// Input: incoming request headers
// Output: x-request-id response header + requestId in derive for the Elysia path
// Position: apps/server/src/http request-id plugin

import { randomUUID } from 'node:crypto'

import { Elysia } from 'elysia'

export const REQUEST_ID_HEADER = 'x-request-id'

export function createRequestIdPlugin() {
  return new Elysia({ name: 'cradle.http.request-id', scoped: false })
    .derive({ as: 'global' }, ({ request, set }) => {
      const incoming = request.headers.get(REQUEST_ID_HEADER)?.trim()
      const requestId = incoming || randomUUID()
      set.headers[REQUEST_ID_HEADER] = requestId
      return { requestId }
    })
}
