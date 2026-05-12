// Input: search HTTP endpoints
// Output: integration tests for thread search over titles and assistant timeline text
// Position: apps/server/tests

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentProfiles,
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

const TIMELINE_SCHEMA_VERSION = 'cradle.timeline.v1'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('search capability', () => {
  it('searches titles, user content, and assistant timeline text with workspace filtering', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRootOne = makeTempDir('cradle-workspace-one-')
    const workspaceRootTwo = makeTempDir('cradle-workspace-two-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const d = db()

      const workspaceOneId = randomUUID()
      const workspaceTwoId = randomUUID()
      const agentProfileId = randomUUID()
      const sessionOneId = randomUUID()
      const sessionTwoId = randomUUID()
      const assistantMessageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      d.insert(workspaces).values([
        { id: workspaceOneId, name: 'Workspace One', path: workspaceRootOne },
        { id: workspaceTwoId, name: 'Workspace Two', path: workspaceRootTwo },
      ]).run()
      d.insert(agentProfiles).values({ id: agentProfileId, name: 'Search Agent', providerKind: 'openai-compatible' }).run()
      d.insert(sessions).values([
        { id: sessionOneId, workspaceId: workspaceOneId, title: 'Alpha deployment', agentProfileId },
        { id: sessionTwoId, workspaceId: workspaceTwoId, title: 'Beta planning', agentProfileId },
      ]).run()
      d.insert(messages).values([
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          role: 'user',
          status: 'complete',
          content: 'The deployment log exploded yesterday',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId: sessionOneId,
          role: 'assistant',
          status: 'complete',
          content: 'fallback assistant text',
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: randomUUID(),
          sessionId: sessionTwoId,
          role: 'user',
          status: 'complete',
          content: 'Planning unrelated roadmap items',
          createdAt: now + 2,
          updatedAt: now + 2,
        },
      ]).run()

      const runId = randomUUID()
      const bindingId = randomUUID()
      d.insert(backendSessionBindings).values({
        id: bindingId,
        chatSessionId: sessionOneId,
        agentProfileId,
        providerKind: 'openai-compatible',
      }).run()
      d.insert(backendRuns).values({
        id: runId,
        bindingId,
        chatSessionId: sessionOneId,
        messageId: assistantMessageId,
        origin: 'user',
        status: 'complete',
        startedAt: now,
        finishedAt: now + 1,
      }).run()
      d.insert(backendTimelineEvents).values([
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionOneId,
          sequenceNumber: 1,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ delta: 'assistant solved ' }),
          sourceJson: JSON.stringify({ backend: 'openai-compatible', eventType: 'response' }),
          createdAt: now,
        },
        {
          id: randomUUID(),
          runId,
          chatSessionId: sessionOneId,
          sequenceNumber: 2,
          eventType: 'assistant.text.delta',
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: JSON.stringify({ delta: 'the deployment issue' }),
          sourceJson: JSON.stringify({ backend: 'openai-compatible', eventType: 'response' }),
          createdAt: now + 1,
        },
      ]).run()

      const assistantSearch = await app.handle(new Request('http://localhost/search/threads?query=assistant%20solved'))
      expect(assistantSearch.status).toBe(200)
      const assistantHits = await assistantSearch.json()
      expect(assistantHits).toHaveLength(1)
      expect(assistantHits[0]).toEqual(expect.objectContaining({
        sessionId: sessionOneId,
        workspaceId: workspaceOneId,
        workspaceName: 'Workspace One',
        sessionTitle: 'Alpha deployment',
      }))
      expect(assistantHits[0].snippets).toEqual([
        expect.objectContaining({ messageRole: 'assistant' }),
      ])
      expect(assistantHits[0].snippets[0].text).toContain('assistant solved')

      const titleScoped = await app.handle(new Request(`http://localhost/search/threads?query=deployment&workspaceId=${encodeURIComponent(workspaceOneId)}`))
      expect(titleScoped.status).toBe(200)
      const scopedHits = await titleScoped.json()
      expect(scopedHits).toHaveLength(1)
      expect(scopedHits[0].sessionId).toBe(sessionOneId)

      const noMatchScoped = await app.handle(new Request(`http://localhost/search/threads?query=deployment&workspaceId=${encodeURIComponent(workspaceTwoId)}`))
      expect(noMatchScoped.status).toBe(200)
      expect(await noMatchScoped.json()).toEqual([])

      const invalidQuery = await app.handle(new Request('http://localhost/search/threads?query='))
      expect(invalidQuery.status).toBe(400)
      expect((await invalidQuery.json()).code).toBe('validation_error')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRootOne, { recursive: true, force: true })
      rmSync(workspaceRootTwo, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
