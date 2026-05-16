// Input: search HTTP endpoints
// Output: integration tests for thread search over titles and assistant message text
// Position: apps/server/tests

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  agentProfiles,
  messages,
  sessions,
  workspaces,
} from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('search capability', () => {
  it('searches titles, user content, and assistant message text with workspace filtering', async () => {
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
      const userMessageOneId = randomUUID()
      const assistantMessageId = randomUUID()
      const userMessageTwoId = randomUUID()
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
          id: userMessageOneId,
          sessionId: sessionOneId,
          role: 'user',
          status: 'complete',
          content: 'The deployment log exploded yesterday',
          messageJson: JSON.stringify({
            id: userMessageOneId,
            role: 'user',
            parts: [{ type: 'text', text: 'The deployment log exploded yesterday' }],
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId: sessionOneId,
          role: 'assistant',
          status: 'complete',
          content: 'assistant solved the deployment issue',
          messageJson: JSON.stringify({
            id: assistantMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'assistant solved the deployment issue' }],
          }),
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: userMessageTwoId,
          sessionId: sessionTwoId,
          role: 'user',
          status: 'complete',
          content: 'Planning unrelated roadmap items',
          messageJson: JSON.stringify({
            id: userMessageTwoId,
            role: 'user',
            parts: [{ type: 'text', text: 'Planning unrelated roadmap items' }],
          }),
          createdAt: now + 2,
          updatedAt: now + 2,
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

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${sessionOneId}`, {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)

      const afterDeleteSearch = await app.handle(new Request('http://localhost/search/threads?query=assistant%20solved'))
      expect(afterDeleteSearch.status).toBe(200)
      expect(await afterDeleteSearch.json()).toEqual([])

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
