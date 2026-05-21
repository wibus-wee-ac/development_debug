import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chronicleEvents, chronicleMemories, chronicleMessages, chronicleMessageSources, chronicleSnapshots } from '@cradle/db'
import { desc, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { runSlackSyncTick, stopSlackBackgroundSync } from '../src/modules/chronicle/service'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function requestJson(
  app: Awaited<ReturnType<typeof createServerApp>>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init))
}

async function putChronicleConfig(
  app: Awaited<ReturnType<typeof createServerApp>>,
  storageRoot: string,
): Promise<Response> {
  return requestJson(app, '/chronicle/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      profileId: '',
      modelId: '',
      workspaceId: '',
      enabled: false,
      storageRoot,
    }),
  })
}

async function postSnapshot(app: Awaited<ReturnType<typeof createServerApp>>, sourceId: string): Promise<Response> {
  return requestJson(app, '/chronicle/snapshots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId,
      displayId: 1,
      frameIndex: 7,
      capturedAt: '2026-05-21T10-00-00Z',
      segmentDir: '1/20260521100000',
      framePath: '1/20260521100000/frame-00007.jpg',
      capturePath: '1/20260521100000/capture-00007.json',
      ocrPath: '1/20260521100000/ocr-00007.json',
      snapshotPath: '1/20260521100000/snapshot.json',
      ocrText: 'TargetAlpha visible in the active Cradle window',
      appBundleId: 'app.cradle.desktop',
      windowTitle: 'Cradle Chronicle',
      metadata: { source: 'test' },
    }),
  })
}

async function postMemory(
  app: Awaited<ReturnType<typeof createServerApp>>,
  input: { sourceId: string, createdAt: string, content: string },
): Promise<Response> {
  return requestJson(app, '/chronicle/memories', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId: input.sourceId,
      windowType: '10min',
      createdAt: input.createdAt,
      memoryPath: `memories/${input.sourceId}.md`,
      content: input.content,
      summaryKind: 'local',
      sourceSnapshotPaths: ['1/20260521100000/snapshot.json'],
      sourceFramePaths: ['1/20260521100000/frame-00007.jpg'],
      metadata: { source: 'test' },
    }),
  })
}

describe('chronicle module', () => {
  it('persists daemon reports, deduplicates sources, exposes model resources, and searches DB-backed memories', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const storageRoot = makeTempDir('cradle-chronicle-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'chronicle-test-secret'
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })

      const configResponse = await putChronicleConfig(app, storageRoot)
      expect(configResponse.status).toBe(200)
      mkdirSync(join(storageRoot, '1/20260521100000'), { recursive: true })
      writeFileSync(join(storageRoot, '1/20260521100000/frame-00007.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

      const snapshotResponse = await postSnapshot(app, 'snapshot-source-1')
      expect(snapshotResponse.status).toBe(200)
      const duplicateSnapshotResponse = await postSnapshot(app, 'snapshot-source-1')
      expect(duplicateSnapshotResponse.status).toBe(200)

      const snapshotCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_snapshots`)?.count
      expect(snapshotCount).toBe(1)

      const timelineResponse = await requestJson(app, '/chronicle/timeline?limit=5')
      expect(timelineResponse.status).toBe(200)
      const timeline = await timelineResponse.json() as Array<{ id: string, ocrText: string | null, framePath: string }>
      expect(timeline).toHaveLength(1)
      expect(timeline[0].ocrText).toContain('TargetAlpha')
      expect(timeline[0].framePath).toBe('1/20260521100000/frame-00007.jpg')

      const frameResponse = await requestJson(app, `/chronicle/snapshots/${timeline[0].id}/frame`)
      expect(frameResponse.status).toBe(200)
      expect(frameResponse.headers.get('content-type')).toBe('image/jpeg')
      expect(await frameResponse.arrayBuffer()).toHaveProperty('byteLength', 4)

      const memoryResponse = await postMemory(app, {
        sourceId: 'memory-source-1',
        createdAt: '2026-05-21T10-05-00Z',
        content: 'A local Chronicle memory mentions TargetAlpha and task planning.',
      })
      expect(memoryResponse.status).toBe(200)

      const duplicateMemoryResponse = await postMemory(app, {
        sourceId: 'memory-source-1',
        createdAt: '2026-05-21T10-06-00Z',
        content: 'Updated TargetAlpha memory.',
      })
      expect(duplicateMemoryResponse.status).toBe(200)

      const memoryCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memories`)?.count
      expect(memoryCount).toBe(1)

      for (let index = 0; index < 25; index += 1) {
        const response = await postMemory(app, {
          sourceId: `memory-noise-${index}`,
          createdAt: `2026-05-21T11-${String(index).padStart(2, '0')}-00Z`,
          content: `Routine Chronicle memory ${index}`,
        })
        expect(response.status).toBe(200)
      }

      const searchResponse = await requestJson(app, '/chronicle/memories/search?q=TargetAlpha&limit=5')
      expect(searchResponse.status).toBe(200)
      const searchResults = await searchResponse.json() as Array<{ id: string, content: string }>
      expect(searchResults).toHaveLength(1)
      expect(searchResults[0].content).toContain('TargetAlpha')

      const resourceResponse = await requestJson(app, '/chronicle/model-resources')
      expect(resourceResponse.status).toBe(200)
      const resources = await resourceResponse.json() as Array<{ category: string, status: string, path: string | null }>
      expect(resources.map(resource => resource.category).sort()).toEqual([
        'audio-asr',
        'audio-vad',
        'embedding',
        'ocr',
        'speaker',
      ])
      expect(resources.find(resource => resource.category === 'ocr')?.status).toBe('available')
      expect(resources.find(resource => resource.category === 'audio-asr')?.path).toBeNull()

      const summarizeResponse = await requestJson(app, '/chronicle/summarize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Summarize this', windowType: '10min' }),
      })
      expect(summarizeResponse.status).toBe(200)
      const summarizeBody = await summarizeResponse.json() as { status: string, memoryId: string | null }
      expect(summarizeBody.status).toBe('error')
      expect(summarizeBody.memoryId).toBeNull()

      const latestEvent = db()
        .select()
        .from(chronicleEvents)
        .where(eq(chronicleEvents.type, 'summarize'))
        .orderBy(desc(chronicleEvents.createdAt))
        .limit(1)
        .get()
      expect(latestEvent?.status).toBe('error')
      expect(latestEvent?.message).toBe('Chronicle is not enabled')

      const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-1')).get()
      const memory = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, 'memory-source-1')).get()
      expect(snapshot?.id).toBeTruthy()
      expect(memory?.sourceSnapshotIdsJson).toContain(snapshot?.id)

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = new URL(input.toString())
        if (url.pathname.endsWith('/conversations.info')) {
          return new Response(JSON.stringify({
            ok: true,
            channel: { id: 'C123', name: 'chronicle-lab' },
          }))
        }
        if (url.pathname.endsWith('/conversations.history')) {
          return new Response(JSON.stringify({
            ok: true,
            messages: [{
              ts: '1779303000.000100',
              user: 'U123',
              username: 'Ada',
              text: 'SlackTargetAlpha should become a Chronicle memory.',
              thread_ts: '1779303000.000100',
            }],
          }))
        }
        return new Response(JSON.stringify({ ok: false, error: 'unexpected_url' }))
      })

      const secretResponse = await requestJson(app, '/secrets/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'chronicle.slack.bot-token',
          label: 'Slack test',
          secret: 'xoxb-test-token',
        }),
      })
      expect(secretResponse.status).toBe(200)
      const secret = await secretResponse.json() as { id: string }

      const sourceResponse = await requestJson(app, '/chronicle/message-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'slack',
          label: 'Slack Lab',
          enabled: true,
          botTokenRef: secret.id,
          channelIds: ['C123'],
        }),
      })
      expect(sourceResponse.status).toBe(200)
      const source = await sourceResponse.json() as { id: string, botTokenRef: string, channelIds: string[] }
      expect(source.botTokenRef).toBe(secret.id)
      expect(source.channelIds).toEqual(['C123'])

      const tickResult = await runSlackSyncTick()
      expect(tickResult).toEqual({ checked: 1, synced: 1, errors: 0 })

      const duplicateSyncResponse = await requestJson(app, `/chronicle/message-sources/${source.id}/sync`, { method: 'POST' })
      expect(duplicateSyncResponse.status).toBe(200)
      const duplicateSyncBody = await duplicateSyncResponse.json() as { status: string, ingested: number }
      expect(duplicateSyncBody.status).toBe('success')
      expect(duplicateSyncBody.ingested).toBe(0)

      const messageCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_messages`)?.count
      expect(messageCount).toBe(1)
      const messageSource = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, source.id)).get()
      expect(messageSource?.botTokenRef).toBe(secret.id)
      expect(JSON.stringify(messageSource)).not.toContain('xoxb-test-token')
      const message = db().select().from(chronicleMessages).where(eq(chronicleMessages.sourceId, source.id)).get()
      expect(message?.text).toContain('SlackTargetAlpha')
      expect(message?.channelName).toBe('chronicle-lab')

      const messageListResponse = await requestJson(app, '/chronicle/messages?limit=5')
      expect(messageListResponse.status).toBe(200)
      const messages = await messageListResponse.json() as Array<{ text: string, channelName: string | null }>
      expect(messages[0].text).toContain('SlackTargetAlpha')
      expect(messages[0].channelName).toBe('chronicle-lab')

      const mixedTimelineResponse = await requestJson(app, '/chronicle/timeline?limit=10')
      expect(mixedTimelineResponse.status).toBe(200)
      const mixedTimeline = await mixedTimelineResponse.json() as Array<{ sourceType?: string, ocrText: string | null }>
      expect(mixedTimeline.some(entry => entry.sourceType === 'message' && entry.ocrText?.includes('SlackTargetAlpha'))).toBe(true)

      const slackSearchResponse = await requestJson(app, '/chronicle/memories/search?q=SlackTargetAlpha&limit=5')
      expect(slackSearchResponse.status).toBe(200)
      const slackSearchResults = await slackSearchResponse.json() as Array<{ content: string }>
      expect(slackSearchResults).toHaveLength(1)
      expect(slackSearchResults[0].content).toContain('SlackTargetAlpha')

      const statusResponse = await requestJson(app, '/chronicle/status')
      expect(statusResponse.status).toBe(200)
      const status = await statusResponse.json() as { totalMessages: number, lastMessageAt: number | null }
      expect(status.totalMessages).toBe(1)
      expect(status.lastMessageAt).toBe(1779303000)

      fetchMock.mockRestore()
    }
    finally {
      vi.restoreAllMocks()
      stopSlackBackgroundSync()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(storageRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousCredentialSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret
      }
    }
  })
})
