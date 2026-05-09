// Input: AppModule metadata and Hono app instance
// Output: cached OpenAPI JSON endpoints and Scalar UI for the local server
// Position: apps/server/src/openapi infrastructure bridge

import { Scalar } from '@scalar/hono-api-reference'
import { createOpenApiDocument } from '@tsuki-hono/openapi'
import type { Hono } from 'hono'

import { AppModule } from '../app.module'

const DOCS_SPEC_PATH = '/docs/openapi.json'

let cachedDocument: ReturnType<typeof createOpenApiDocument> | null = null

function getOpenApiDocument() {
  if (cachedDocument) {
    return cachedDocument
  }

  cachedDocument = createOpenApiDocument(AppModule, {
    title: 'Cradle Server API',
    version: '0.0.1',
    description: 'Local-first HTTP API for Cradle server capabilities.',
    servers: [{ url: '/' }],
  })
  return cachedDocument
}

export function registerOpenApiRoutes(hono: Hono) {
  hono.get('/openapi.json', c => c.json(getOpenApiDocument()))
  hono.get(DOCS_SPEC_PATH, c => c.json(getOpenApiDocument()))
  hono.get('/docs', Scalar({
    url: DOCS_SPEC_PATH,
    pageTitle: 'Cradle API Reference',
    theme: 'default',
    showOperationId: true,
    documentDownloadType: 'json',
  }))
}
