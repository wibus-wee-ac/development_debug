// Input: OpenAPI JSON endpoint from createConfiguredApp
// Output: integration test for generated OpenAPI paths and DTO-backed component schemas
// Position: apps/server/tests

import 'reflect-metadata'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createConfiguredApp } from '../src/app.factory'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('openapi capability', () => {
  it('serves a generated OpenAPI document and Scalar UI with profile/provider schemas', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createConfiguredApp()

    try {
      const hono = app.getInstance()
      const response = await hono.request('/openapi.json')
      expect(response.status).toBe(200)

      const document = await response.json() as {
        openapi: string
        info: { title: string }
        paths: Record<string, Record<string, {
          parameters?: Array<{ name: string }>
          requestBody?: { content?: { 'application/json'?: { schema?: { $ref?: string } } } }
        }>>
        components?: { schemas?: Record<string, unknown> }
      }

      expect(document.openapi).toBe('3.1.0')
      expect(document.info.title).toBe('Cradle Server API')
      expect(document.paths['/profiles/{id}']?.put?.requestBody?.content?.['application/json']?.schema?.$ref)
        .toBe('#/components/schemas/UpsertProfileBody')
      expect(document.paths['/sessions/{id}']?.patch).toBeTruthy()
      expect(document.paths['/sessions/{id}/title']).toBeUndefined()
      expect(document.paths['/sessions/{id}/toggle-pin']).toBeUndefined()
      expect(document.paths['/chat/runs/{runId}']?.patch).toBeTruthy()
      expect(document.paths['/chat/runs/{runId}/abort']).toBeUndefined()
      expect(document.paths['/kanban/issues/{id}/move']).toBeUndefined()
      expect(document.paths['/acp/agents/{agentId}/installation']?.put).toBeTruthy()
      expect(document.paths['/acp/agents/{agentId}/installation']?.delete).toBeTruthy()
      expect(document.paths['/acp/agents/{agentId}/install']).toBeUndefined()
      expect(document.paths['/acp/agents/{agentId}/cancel-install']).toBeUndefined()
      expect(document.paths['/kanban/issues/{issueId}/delegation']).toBeTruthy()
      expect(document.paths['/kanban/issues/{issueId}/agent-sessions']).toBeTruthy()
      expect(document.paths['/issue-agent/issues/{issueId}/delegation']).toBeUndefined()
      expect(document.paths['/issue-agent-sessions/{agentSessionId}/activities']).toBeTruthy()
      expect(document.paths['/providers/models']?.post?.requestBody?.content?.['application/json']?.schema?.$ref)
        .toBe('#/components/schemas/ProviderBody')
      expect(document.paths['/providers/health-check']?.post?.requestBody?.content?.['application/json']?.schema?.$ref)
        .toBe('#/components/schemas/ProviderBody')
      expect(document.components?.schemas).toEqual(expect.objectContaining({
        UpsertProfileBody: expect.any(Object),
        ProviderBody: expect.any(Object),
      }))

      const aliasResponse = await hono.request('/docs/openapi.json')
      expect(aliasResponse.status).toBe(200)
      expect(await aliasResponse.json()).toEqual(document)

      const docsResponse = await hono.request('/docs')
      expect(docsResponse.status).toBe(200)
      expect(docsResponse.headers.get('content-type')).toContain('text/html')
      const html = await docsResponse.text()
      expect(html).toContain('Cradle API Reference')
      expect(html).toContain('/docs/openapi.json')
    }
    finally {
      await app.close()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})