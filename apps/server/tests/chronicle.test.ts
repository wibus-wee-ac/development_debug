import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chronicleAccessibilitySnapshots,
  chronicleActivitySegments,
  chronicleAudioRawSegments,
  chronicleAudioSegments,
  chronicleAudioTranscripts,
  chronicleDreamCandidates,
  chronicleDreamRuns,
  chronicleEvents,
  chronicleKnowledgeCards,
  chronicleKnowledgeSources,
  chronicleKnowledgeVersions,
  chronicleMemories,
  chronicleMemoryChunks,
  chronicleMemoryEmbeddings,
  chronicleMemoryKeywords,
  chronicleMessages,
  chronicleMessageSources,
  chroniclePipelineRuns,
  chronicleSpeakerProfiles,
  chronicleSnapshots,
} from '@cradle/db'
import { generateText } from 'ai'
import { desc, eq, sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { runSlackSyncTick, stopActivityPipelineScheduler, stopSlackBackgroundSync } from '../src/modules/chronicle/service'

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

const mockedGenerateText = vi.mocked(generateText)

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

function signSlackBody(rawBody: string, signingSecret: string, timestamp: number): string {
  const base = `v0:${timestamp}:${rawBody}`
  return `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`
}

function readJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  }
  catch {
    return fallback
  }
}

function writeChroniclePreference(dataDir: string, storageRoot: string, patch: Record<string, unknown>): void {
  const preferencesDir = join(dataDir, 'preferences')
  mkdirSync(preferencesDir, { recursive: true })
  writeFileSync(join(preferencesDir, 'chronicle.json'), JSON.stringify({
    profileId: '',
    modelId: '',
    workspaceId: '',
    enabled: false,
    activityPipelineEnabled: true,
    activityPipelineIntervalMs: 120_000,
    activityPipelineBatchSize: 3,
    audioCaptureEnabled: false,
    audioSegmentMs: 5_000,
    audioSegmentIntervalMs: 60_000,
    audioRmsThreshold: 0.02,
    storageRoot,
    ...patch,
  }, null, 2))
}

async function postSignedSlackEvent(
  app: Awaited<ReturnType<typeof createServerApp>>,
  sourceId: string,
  body: Record<string, unknown>,
  signingSecret: string,
  options: { signature?: string, timestamp?: number } = {},
): Promise<Response> {
  const rawBody = JSON.stringify(body)
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  return requestJson(app, `/chronicle/message-sources/${sourceId}/slack/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': options.signature ?? signSlackBody(rawBody, signingSecret, timestamp),
    },
    body: rawBody,
  })
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
      activityPipelineEnabled: true,
      activityPipelineIntervalMs: 120_000,
      activityPipelineBatchSize: 3,
      audioCaptureEnabled: false,
      audioSegmentMs: 5_000,
      audioSegmentIntervalMs: 60_000,
      audioRmsThreshold: 0.02,
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
      accessibility: {
        sourceId: `accessibility:${sourceId}`,
        status: 'ready',
        provider: 'macos-accessibility-window-inventory',
        accessibilityPath: '1/20260521100000/accessibility.json',
        text: 'Cradle Chronicle AX target',
        elementCount: 2,
        tree: [
          { role: 'AXWindow', label: 'Cradle Chronicle', depth: 0, path: 'root' },
          { role: 'AXButton', label: 'Record', depth: 1, path: 'root/AXChildren:0' },
        ],
        metadata: { source: 'test-accessibility' },
      },
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
    shutdownInfra()
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp({ startBackgroundTasks: false })

      const configResponse = await putChronicleConfig(app, storageRoot)
      expect(configResponse.status).toBe(200)
      const audioConfigResponse = await requestJson(app, '/chronicle/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: '',
          modelId: '',
          workspaceId: '',
          enabled: false,
          activityPipelineEnabled: true,
          activityPipelineIntervalMs: 120_000,
          activityPipelineBatchSize: 3,
          audioCaptureEnabled: true,
          audioSegmentMs: 50,
          audioSegmentIntervalMs: 50,
          audioRmsThreshold: 2,
          storageRoot,
        }),
      })
      expect(audioConfigResponse.status).toBe(200)
      const audioConfig = await audioConfigResponse.json() as {
        audioCaptureEnabled: boolean
        audioSegmentMs: number
        audioSegmentIntervalMs: number
        audioRmsThreshold: number
      }
      expect(audioConfig.audioCaptureEnabled).toBe(true)
      expect(audioConfig.audioSegmentMs).toBe(100)
      expect(audioConfig.audioSegmentIntervalMs).toBe(100)
      expect(audioConfig.audioRmsThreshold).toBe(1)
      mkdirSync(join(storageRoot, '1/20260521100000'), { recursive: true })
      writeFileSync(join(storageRoot, '1/20260521100000/frame-00007.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

      const snapshotResponse = await postSnapshot(app, 'snapshot-source-1')
      expect(snapshotResponse.status).toBe(200)
      const duplicateSnapshotResponse = await postSnapshot(app, 'snapshot-source-1')
      expect(duplicateSnapshotResponse.status).toBe(200)

      const snapshotCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_snapshots`)?.count
      expect(snapshotCount).toBe(1)
      const accessibilityRows = db()
        .select()
        .from(chronicleAccessibilitySnapshots)
        .where(eq(chronicleAccessibilitySnapshots.sourceId, 'accessibility:snapshot-source-1'))
        .all()
      expect(accessibilityRows).toHaveLength(1)
      expect(accessibilityRows[0].snapshotId).toBe(db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-1')).get()?.id)
      expect(accessibilityRows[0].status).toBe('ready')
      expect(accessibilityRows[0].provider).toBe('macos-accessibility-window-inventory')
      expect(accessibilityRows[0].text).toContain('Cradle Chronicle AX target')
      expect(accessibilityRows[0].elementCount).toBe(2)
      expect(accessibilityRows[0].metadataJson).toContain('accessibility.json')
      expect(accessibilityRows[0].treeJson).toContain('Cradle Chronicle')
      const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-1')).get()
      const snapshotActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.snapshotIds?.includes(snapshot!.id)
        })
      expect(snapshotActivitySegment?.segmentType).toBe('work')
      expect(snapshotActivitySegment?.frontApp).toBe('app.cradle.desktop')
      const snapshotRefs = readJson<Record<string, string[]>>(snapshotActivitySegment!.sourceRefsJson, {})
      expect(snapshotRefs.snapshotIds).toEqual([snapshot!.id])
      expect(snapshotRefs.accessibilitySnapshotIds).toEqual([accessibilityRows[0].id])
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_pipeline_runs WHERE trigger = 'snapshot'`)?.count).toBe(1)

      const accessibilityListResponse = await requestJson(app, '/chronicle/accessibility-snapshots?limit=5')
      expect(accessibilityListResponse.status).toBe(200)
      const accessibilityList = await accessibilityListResponse.json() as Array<{
        sourceId: string
        status: string
        provider: string
        elementCount: number
        tree: Array<{ label?: string, depth?: number, path?: string }>
        metadata: { artifactPath?: string }
      }>
      expect(accessibilityList[0].sourceId).toBe('accessibility:snapshot-source-1')
      expect(accessibilityList[0].status).toBe('ready')
      expect(accessibilityList[0].provider).toBe('macos-accessibility-window-inventory')
      expect(accessibilityList[0].elementCount).toBe(2)
      expect(accessibilityList[0].tree[0].label).toBe('Cradle Chronicle')
      expect(accessibilityList[0].tree[0].depth).toBe(0)
      expect(accessibilityList[0].tree[0].path).toBe('root')
      expect(accessibilityList[0].metadata.artifactPath).toBe('1/20260521100000/accessibility.json')

      const axTreeSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-ax-tree',
          displayId: 1,
          frameIndex: 6,
          capturedAt: '2026-05-21T09-59-00Z',
          segmentDir: '1/20260521095900',
          framePath: '1/20260521095900/frame-00006.jpg',
          ocrText: 'AX tree source',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Chronicle AX Tree',
          accessibility: {
            sourceId: 'accessibility:snapshot-source-ax-tree',
            status: 'ready',
            provider: 'macos-ax-tree-poll',
            accessibilityPath: '1/20260521095900/accessibility.json',
            text: 'Cradle Chronicle AX Tree\nSearch field',
            elementCount: 2,
            tree: [
              { role: 'AXWindow', label: 'Cradle Chronicle AX Tree', depth: 0, path: 'root' },
              { role: 'AXTextField', label: 'Search field', value: 'TargetAlpha', depth: 1, path: 'root/AXChildren:0' },
            ],
            metadata: { source: 'test-ax-tree' },
          },
        }),
      })
      expect(axTreeSnapshotResponse.status).toBe(200)
      const axTreeAccessibility = db()
        .select()
        .from(chronicleAccessibilitySnapshots)
        .where(eq(chronicleAccessibilitySnapshots.sourceId, 'accessibility:snapshot-source-ax-tree'))
        .get()
      expect(axTreeAccessibility?.status).toBe('ready')
      expect(axTreeAccessibility?.provider).toBe('macos-ax-tree-poll')
      expect(axTreeAccessibility?.treeJson).toContain('AXTextField')

      const laterSameTitleSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-later-same-title',
          displayId: 1,
          frameIndex: 9,
          capturedAt: '2026-05-21T10:20:00Z',
          segmentDir: '1/20260521102000',
          framePath: '1/20260521102000/frame-00009.jpg',
          ocrText: 'Later same title source',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Chronicle',
        }),
      })
      expect(laterSameTitleSnapshotResponse.status).toBe(200)
      const backfilledSameTitleSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-backfill-same-title',
          displayId: 1,
          frameIndex: 5,
          capturedAt: '2026-05-21T10:10:00Z',
          segmentDir: '1/20260521101000',
          framePath: '1/20260521101000/frame-00005.jpg',
          ocrText: 'Backfilled same title source',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Chronicle',
        }),
      })
      expect(backfilledSameTitleSnapshotResponse.status).toBe(200)
      const laterSameTitleSnapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-later-same-title')).get()
      const backfilledSameTitleSnapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-backfill-same-title')).get()
      const segmentWithLaterSnapshot = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.snapshotIds?.includes(laterSameTitleSnapshot!.id)
        })
      const segmentWithBackfilledSnapshot = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.snapshotIds?.includes(backfilledSameTitleSnapshot!.id)
        })
      expect(segmentWithLaterSnapshot?.id).not.toBe(segmentWithBackfilledSnapshot?.id)

      const permissionDeniedSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-permission-denied',
          displayId: 1,
          frameIndex: 8,
          capturedAt: '2026-05-21T10-01-00Z',
          segmentDir: '1/20260521100100',
          framePath: '1/20260521100100/frame-00008.jpg',
          ocrText: 'Permission denied AX source',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Chronicle Permission',
          accessibility: {
            sourceId: 'accessibility:snapshot-source-permission-denied',
            status: 'permission-denied',
            provider: 'macos-accessibility-window-inventory',
            accessibilityPath: '1/20260521100100/accessibility.json',
            text: null,
            elementCount: 0,
            tree: [],
            metadata: { source: 'test-accessibility-denied' },
          },
        }),
      })
      expect(permissionDeniedSnapshotResponse.status).toBe(200)
      const permissionDeniedAccessibility = db()
        .select()
        .from(chronicleAccessibilitySnapshots)
        .where(eq(chronicleAccessibilitySnapshots.sourceId, 'accessibility:snapshot-source-permission-denied'))
        .get()
      expect(permissionDeniedAccessibility?.status).toBe('permission-denied')
      expect(permissionDeniedAccessibility?.elementCount).toBe(0)
      expect(permissionDeniedAccessibility?.metadataJson).toContain('accessibility.json')
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_accessibility_snapshots`)?.count).toBe(3)

      const timelineResponse = await requestJson(app, '/chronicle/timeline?limit=5')
      expect(timelineResponse.status).toBe(200)
      const timeline = await timelineResponse.json() as Array<{ id: string, ocrText: string | null, framePath: string }>
      const targetTimelineEntry = timeline.find(entry => entry.framePath === '1/20260521100000/frame-00007.jpg')
      expect(targetTimelineEntry?.ocrText).toContain('TargetAlpha')
      expect(timeline.some(entry => entry.ocrText?.includes('Permission denied AX source'))).toBe(true)

      const frameResponse = await requestJson(app, `/chronicle/snapshots/${targetTimelineEntry!.id}/frame`)
      expect(frameResponse.status).toBe(200)
      expect(frameResponse.headers.get('content-type')).toBe('image/jpeg')
      expect(await frameResponse.arrayBuffer()).toHaveProperty('byteLength', 4)

      db().insert(chronicleMemories).values({
        id: 'legacy-memory-without-index',
        sourceId: 'legacy-memory-source',
        contentHash: null,
        workspaceId: null,
        type: '10min',
        source: 'imported',
        content: 'LegacyBackfillAlpha should become searchable after reconciliation.',
        prompt: null,
        sourceSnapshotIdsJson: '[]',
        sourcePathsJson: '[]',
        modelProfileId: null,
        modelId: null,
        usageJson: '{}',
        metadataJson: '{}',
        createdAt: 1779300200,
        updatedAt: 1779300200,
      }).run()
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memory_keywords WHERE memory_id = 'legacy-memory-without-index'`)?.count).toBe(0)
      const legacySearchResponse = await requestJson(app, '/chronicle/memories/search?q=LegacyBackfillAlpha&limit=5')
      expect(legacySearchResponse.status).toBe(200)
      const legacySearchResults = await legacySearchResponse.json() as Array<{ id: string, content: string }>
      expect(legacySearchResults).toHaveLength(1)
      expect(legacySearchResults[0].id).toBe('legacy-memory-without-index')
      const backfilledLegacyMemory = db().select().from(chronicleMemories).where(eq(chronicleMemories.id, 'legacy-memory-without-index')).get()
      expect(backfilledLegacyMemory?.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memory_keywords WHERE memory_id = 'legacy-memory-without-index'`)?.count).toBeGreaterThan(0)

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

      const memorySourceCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memories WHERE source_id = 'memory-source-1'`)?.count
      expect(memorySourceCount).toBe(1)
      const indexedMemory = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, 'memory-source-1')).get()
      expect(indexedMemory?.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_pipeline_runs WHERE memory_ids_json = ${JSON.stringify([indexedMemory!.id])}`)?.count).toBe(1)
      const chunkCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memory_chunks WHERE memory_id = ${indexedMemory?.id}`)?.count
      expect(chunkCount).toBe(1)
      const keywordTerms = db()
        .select({ term: chronicleMemoryKeywords.term })
        .from(chronicleMemoryKeywords)
        .where(eq(chronicleMemoryKeywords.memoryId, indexedMemory!.id))
        .all()
        .map(row => row.term)
      expect(keywordTerms).toContain('targetalpha')
      expect(keywordTerms).toContain('updated')
      const embeddingRows = db()
        .select()
        .from(chronicleMemoryEmbeddings)
        .where(eq(chronicleMemoryEmbeddings.memoryId, indexedMemory!.id))
        .all()
      expect(embeddingRows).toHaveLength(1)
      expect(embeddingRows[0].modelId).toBe('chronicle-lexical')
      expect(embeddingRows[0].dimensions).toBe(64)
      const indexedChunk = db().select().from(chronicleMemoryChunks).where(eq(chronicleMemoryChunks.memoryId, indexedMemory!.id)).get()
      expect(indexedChunk?.embeddingStatus).toBe('missing')
      expect(indexedChunk?.embeddingModelId).toBeNull()

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
      expect(searchResults.length).toBeGreaterThanOrEqual(1)
      expect(searchResults[0].content).toContain('TargetAlpha')

      const semanticOnlyResponse = await requestJson(app, '/chronicle/memories/search?q=targetalphaness&limit=5')
      expect(semanticOnlyResponse.status).toBe(200)
      const semanticOnlyResults = await semanticOnlyResponse.json() as Array<{
        id: string
        content: string
        matchKind: string | null
        keywordScore: number | null
        semanticScore: number | null
      }>
      expect(semanticOnlyResults.length).toBeGreaterThanOrEqual(1)
      expect(semanticOnlyResults[0].content).toContain('TargetAlpha')
      expect(semanticOnlyResults[0].matchKind).toBe('semantic')
      expect(semanticOnlyResults[0].keywordScore).toBe(0)
      expect(semanticOnlyResults[0].semanticScore).toBeGreaterThan(0)

      const staleSearchResponse = await requestJson(app, '/chronicle/memories/search?q=planning&limit=5')
      expect(staleSearchResponse.status).toBe(200)
      const staleSearchResults = await staleSearchResponse.json() as Array<{ id: string, content: string }>
      expect(staleSearchResults.every(result => !result.content.includes('task planning'))).toBe(true)
      expect(db()
        .select()
        .from(chronicleMemoryKeywords)
        .where(sql`${chronicleMemoryKeywords.memoryId} = ${indexedMemory!.id} AND ${chronicleMemoryKeywords.term} = 'planning'`)
        .all()).toHaveLength(0)

      const semanticDuplicateResponse = await postMemory(app, {
        sourceId: 'memory-source-duplicate',
        createdAt: '2026-05-21T10-07-00Z',
        content: '  updated   targetalpha MEMORY. ',
      })
      expect(semanticDuplicateResponse.status).toBe(200)
      const semanticDuplicateBody = await semanticDuplicateResponse.json() as { id: string }
      expect(semanticDuplicateBody.id).toBe(indexedMemory?.id)
      const dedupedMemoryCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memories WHERE content_hash = ${indexedMemory?.contentHash}`)?.count
      expect(dedupedMemoryCount).toBe(1)
      const duplicateEvent = db()
        .select()
        .from(chronicleEvents)
        .where(eq(chronicleEvents.message, 'Chronicle memory duplicate merged'))
        .get()
      expect(duplicateEvent?.memoryId).toBe(indexedMemory?.id)
      expect(db().select().from(chronicleMemoryChunks).where(eq(chronicleMemoryChunks.memoryId, indexedMemory!.id)).all()).toHaveLength(1)

      const updateSourceResponse = await postMemory(app, {
        sourceId: 'memory-update-source',
        createdAt: '2026-05-21T10-08-00Z',
        content: 'Temporary distinct Chronicle memory.',
      })
      expect(updateSourceResponse.status).toBe(200)
      const updateSourceBody = await updateSourceResponse.json() as { id: string }
      expect(updateSourceBody.id).not.toBe(indexedMemory?.id)
      const updateIntoDuplicateResponse = await postMemory(app, {
        sourceId: 'memory-update-source',
        createdAt: '2026-05-21T10-09-00Z',
        content: 'Updated TargetAlpha memory.',
      })
      expect(updateIntoDuplicateResponse.status).toBe(200)
      const updateIntoDuplicateBody = await updateIntoDuplicateResponse.json() as { id: string }
      expect(updateIntoDuplicateBody.id).toBe(indexedMemory?.id)
      expect(db().select().from(chronicleMemories).where(eq(chronicleMemories.id, updateSourceBody.id)).get()).toBeUndefined()
      expect(db().select().from(chronicleMemoryChunks).where(eq(chronicleMemoryChunks.memoryId, updateSourceBody.id)).all()).toHaveLength(0)

      const resourceResponse = await requestJson(app, '/chronicle/model-resources')
      expect(resourceResponse.status).toBe(200)
      const resources = await resourceResponse.json() as Array<{
        category: string
        status: string
        path: string | null
        displayName: string
        metadata: {
          function?: string
          manifest?: {
            files?: Array<Record<string, unknown>>
          }
        }
      }>
      expect(resources.map(resource => resource.category).sort()).toEqual([
        'audio-asr',
        'audio-vad',
        'embedding',
        'ocr',
        'pii',
        'speaker',
      ])
      expect(resources.find(resource => resource.category === 'ocr')?.status).toBe('available')
      expect(resources.find(resource => resource.category === 'audio-asr')?.path).toBeNull()
      const speakerResource = resources.find(resource => resource.category === 'speaker')
      expect(speakerResource?.displayName).toBe('Speaker Embedding Extractor')
      expect(speakerResource?.metadata.function).toBe('speaker-embedding-extractor')
      expect(speakerResource?.metadata.manifest?.files).toEqual([
        expect.objectContaining({
          path: 'speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
          sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
          sizeBytes: 28_281_164,
        }),
      ])

      const speakerManifestFetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('invalid speaker extractor bytes', { status: 200 }),
      )
      const speakerManifestInstallResponse = await requestJson(app, '/chronicle/model-resources/speaker/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'manifest' }),
      })
      expect(speakerManifestInstallResponse.status).toBe(200)
      const speakerManifestInstallBody = await speakerManifestInstallResponse.json() as { status: string, message: string | null }
      expect(speakerManifestInstallBody.status).toBe('error')
      expect(speakerManifestInstallBody.message).toContain('Size check failed for speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx')
      expect(speakerManifestInstallBody.message).not.toContain('Manifest install requires source URL')
      expect(speakerManifestFetchMock).toHaveBeenCalledWith(
        'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
        expect.objectContaining({
          headers: { 'User-Agent': 'Cradle/1.0' },
          redirect: 'follow',
        }),
      )
      speakerManifestFetchMock.mockRestore()

      const sourceModelPath = join(storageRoot, 'silero_vad.onnx')
      writeFileSync(sourceModelPath, Buffer.alloc(643_854, 0x41))
      const localInstallResponse = await requestJson(app, '/chronicle/model-resources/audio-vad/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'local-files', sourceRoot: sourceModelPath }),
      })
      expect(localInstallResponse.status).toBe(200)
      const rejectedVad = await localInstallResponse.json() as {
        status: string
        path: string | null
        metadata: { modelsRoot?: string }
      }
      expect(rejectedVad.status).toBe('error')
      expect(rejectedVad.path).toBe('audio-vad/silero_vad.onnx')
      expect(rejectedVad.message).toContain('Checksum failed for audio-vad/silero_vad.onnx')
      expect(rejectedVad.metadata.modelsRoot).toBe(join(dataDir, 'chronicle', 'models'))
      expect(existsSync(join(dataDir, 'chronicle', 'models', 'audio-vad', 'silero_vad.onnx'))).toBe(false)
      expect(existsSync(join(storageRoot, 'models', 'audio-vad', 'silero_vad.onnx'))).toBe(false)

      const removeVadResponse = await requestJson(app, '/chronicle/model-resources/audio-vad', { method: 'DELETE' })
      expect(removeVadResponse.status).toBe(200)
      const removedVad = await removeVadResponse.json() as { status: string, path: string | null }
      expect(removedVad.status).toBe('missing')
      expect(removedVad.path).toBeNull()
      expect(existsSync(join(dataDir, 'chronicle', 'models', 'audio-vad', 'silero_vad.onnx'))).toBe(false)

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

      const memory = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, 'memory-source-1')).get()
      expect(snapshot?.id).toBeTruthy()
      expect(memory?.sourceSnapshotIdsJson).toContain(snapshot?.id)

      const transcriptResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-source-1',
          title: 'Chronicle Planning Meeting',
          source: 'asr',
          status: 'completed',
          startedAt: '2026-05-21T10:30:00Z',
          endedAt: '2026-05-21T10:45:00Z',
          language: 'en',
          appBundleId: 'us.zoom.xos',
          windowTitle: 'Chronicle planning',
          transcriptPath: 'audio/meeting-source-1/transcript.json',
          segments: [
            {
              startMs: 0,
              endMs: 2500,
              speakerLabel: 'Ada',
              text: 'AudioTargetAlpha should become searchable from the meeting transcript.',
              confidence: 0.94,
              language: 'en',
            },
            {
              startMs: 2600,
              endMs: 5200,
              speakerLabel: 'Lin',
              text: 'The transcript should also appear in the activity timeline.',
              confidence: 0.91,
              language: 'en',
            },
          ],
          metadata: { source: 'test' },
        }),
      })
      expect(transcriptResponse.status).toBe(200)
      const transcriptBody = await transcriptResponse.json() as {
        id: string
        memoryId: string | null
        segmentCount: number
        previewText: string
        segments: Array<{ speakerLabel: string | null, confidence: number | null }>
      }
      expect(transcriptBody.memoryId).toBeTruthy()
      expect(transcriptBody.segmentCount).toBe(2)
      expect(transcriptBody.previewText).toContain('AudioTargetAlpha')
      expect(transcriptBody.segments[0].speakerLabel).toBe('Ada')
      expect(transcriptBody.segments[0].confidence).toBe(0.94)
      expect(db().select().from(chronicleAudioTranscripts).where(eq(chronicleAudioTranscripts.sourceId, 'meeting-source-1')).get()?.memoryId).toBe(transcriptBody.memoryId)
      expect(db().select().from(chronicleAudioSegments).where(eq(chronicleAudioSegments.transcriptId, transcriptBody.id)).all()).toHaveLength(2)
      const speakerProfilesResponse = await requestJson(app, '/chronicle/speaker-profiles')
      expect(speakerProfilesResponse.status).toBe(200)
      const speakerProfiles = await speakerProfilesResponse.json() as Array<{
        displayName: string
        normalizedLabel: string
        sampleCount: number
        sourceTranscriptId: string | null
      }>
      expect(speakerProfiles.map(profile => profile.displayName).sort()).toEqual(['Ada', 'Lin'])
      expect(speakerProfiles.find(profile => profile.displayName === 'Ada')?.normalizedLabel).toBe('ada')
      expect(speakerProfiles.find(profile => profile.displayName === 'Ada')?.sampleCount).toBe(1)
      expect(speakerProfiles.find(profile => profile.displayName === 'Ada')?.sourceTranscriptId).toBe(transcriptBody.id)
      expect(db().select().from(chronicleSpeakerProfiles).all()).toHaveLength(2)

      const updatedTranscriptResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-source-1',
          title: 'Chronicle Planning Meeting Updated',
          source: 'asr',
          status: 'completed',
          startedAt: '2026-05-21T10:30:00Z',
          endedAt: '2026-05-21T10:40:00Z',
          language: 'en',
          segments: [{
            startMs: 1000,
            endMs: 3200,
            speakerLabel: 'Ada',
            text: 'AudioTargetBeta replaced the previous transcript text.',
            confidence: 0.97,
            language: 'en',
          }],
          metadata: { source: 'test-update' },
        }),
      })
      expect(updatedTranscriptResponse.status).toBe(200)
      const updatedTranscriptBody = await updatedTranscriptResponse.json() as {
        id: string
        memoryId: string | null
        segmentCount: number
        previewText: string
      }
      expect(updatedTranscriptBody.id).toBe(transcriptBody.id)
      expect(updatedTranscriptBody.memoryId).toBe(transcriptBody.memoryId)
      expect(updatedTranscriptBody.segmentCount).toBe(1)
      expect(updatedTranscriptBody.previewText).toContain('AudioTargetBeta')
      expect(updatedTranscriptBody.previewText).not.toContain('AudioTargetAlpha')
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_transcripts WHERE source_id = 'meeting-source-1'`)?.count).toBe(1)
      const updatedSegments = db().select().from(chronicleAudioSegments).where(eq(chronicleAudioSegments.transcriptId, transcriptBody.id)).all()
      expect(updatedSegments).toHaveLength(1)
      expect(updatedSegments[0].text).toContain('AudioTargetBeta')
      expect(updatedSegments[0].text).not.toContain('AudioTargetAlpha')
      const updatedAdaProfile = db()
        .select()
        .from(chronicleSpeakerProfiles)
        .where(eq(chronicleSpeakerProfiles.normalizedLabel, 'ada'))
        .get()
      expect(updatedAdaProfile?.sampleCount).toBe(2)
      const manualSpeakerProfileResponse = await requestJson(app, '/chronicle/speaker-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Ada',
          aliases: ['Ada Lovelace'],
          embedding: [0.1, 0.2, 0.3],
          embeddingModelId: 'test-speaker-extractor',
          sampleCount: 3,
          lastSeenAt: '2026-05-21T10:40:00Z',
          metadata: { source: 'manual-test' },
        }),
      })
      expect(manualSpeakerProfileResponse.status).toBe(200)
      const manualSpeakerProfile = await manualSpeakerProfileResponse.json() as {
        displayName: string
        aliases: string[]
        embeddingDimensions: number | null
        embeddingModelId: string | null
        sampleCount: number
      }
      expect(manualSpeakerProfile.displayName).toBe('Ada')
      expect(manualSpeakerProfile.aliases).toContain('Ada Lovelace')
      expect(manualSpeakerProfile.embeddingDimensions).toBe(3)
      expect(manualSpeakerProfile.embeddingModelId).toBe('test-speaker-extractor')
      expect(manualSpeakerProfile.sampleCount).toBe(5)
      const transcriptActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.audioTranscriptIds?.includes(transcriptBody.id)
        })
      expect(transcriptActivitySegment?.segmentType).toBe('meeting')
      expect(transcriptActivitySegment?.title).toBe('Chronicle Planning Meeting')
      const transcriptActivityRefs = readJson<Record<string, string[]>>(transcriptActivitySegment!.sourceRefsJson, {})
      expect(transcriptActivityRefs.audioTranscriptIds).toEqual([transcriptBody.id])
      expect(transcriptActivityRefs.memoryIds).toEqual([transcriptBody.memoryId])

      const transcriptListResponse = await requestJson(app, '/chronicle/audio-transcripts?limit=5')
      expect(transcriptListResponse.status).toBe(200)
      const transcriptList = await transcriptListResponse.json() as Array<{ sourceId: string, previewText: string }>
      expect(transcriptList[0].sourceId).toBe('meeting-source-1')
      expect(transcriptList[0].previewText).toContain('AudioTargetBeta')

      const transcriptSearchResponse = await requestJson(app, '/chronicle/memories/search?q=AudioTargetBeta&limit=5')
      expect(transcriptSearchResponse.status).toBe(200)
      const transcriptSearchResults = await transcriptSearchResponse.json() as Array<{ content: string }>
      expect(transcriptSearchResults.length).toBeGreaterThanOrEqual(1)
      expect(transcriptSearchResults[0].content).toContain('AudioTargetBeta')

      const staleTranscriptSearchResponse = await requestJson(app, '/chronicle/memories/search?q=AudioTargetAlpha&limit=5')
      expect(staleTranscriptSearchResponse.status).toBe(200)
      const staleTranscriptSearchResults = await staleTranscriptSearchResponse.json() as Array<{ content: string }>
      expect(staleTranscriptSearchResults.every(result => !result.content.includes('AudioTargetAlpha'))).toBe(true)

      const invalidTimestampResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-invalid-time',
          startedAt: 'not-a-date',
          segments: [{ startMs: 0, text: 'Invalid timestamp should be rejected.' }],
        }),
      })
      expect(invalidTimestampResponse.status).toBe(400)

      const invalidEndedAtResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-invalid-ended-at',
          startedAt: '2026-05-21T10:30:00Z',
          endedAt: 'not-a-date',
          segments: [{ startMs: 0, text: 'Invalid endedAt should be rejected.' }],
        }),
      })
      expect(invalidEndedAtResponse.status).toBe(400)

      const reversedTranscriptTimeResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-reversed-time',
          startedAt: '2026-05-21T10:45:00Z',
          endedAt: '2026-05-21T10:30:00Z',
          segments: [{ startMs: 0, text: 'Reversed transcript range should be rejected.' }],
        }),
      })
      expect(reversedTranscriptTimeResponse.status).toBe(400)

      const reversedSegmentResponse = await requestJson(app, '/chronicle/audio-transcripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'meeting-reversed-segment',
          startedAt: '2026-05-21T10:30:00Z',
          segments: [{
            startMs: 5000,
            endMs: 1000,
            text: 'Reversed segment range should be rejected.',
          }],
        }),
      })
      expect(reversedSegmentResponse.status).toBe(400)

      const rawAudioResponse = await requestJson(app, '/chronicle/audio-raw-segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'audio:microphone:segment-1',
          recordedAt: '2026-05-21T10:50:00Z',
          source: 'microphone',
          status: 'captured',
          audioPath: join(storageRoot, 'audio/segments/segment-1.wav'),
          metadataPath: join(storageRoot, 'audio/segments/segment-1.json'),
          sampleRate: 16_000,
          channels: 1,
          sampleCount: 8_000,
          droppedSamples: 3,
          rms: 0.1234,
          peak: 0.9876,
          active: true,
          vadImplemented: false,
          asrImplemented: false,
          speakerLabelingImplemented: false,
          metadata: { sourceSampleFormat: 'f32' },
        }),
      })
      expect(rawAudioResponse.status).toBe(200)
      const rawAudioBody = await rawAudioResponse.json() as {
        id: string
        sourceId: string
        audioPath: string
        metadataPath: string
        durationMs: number
        rms: number
        peak: number
        active: boolean
        vadStatus: string
        asrStatus: string
        speakerStatus: string
        metadata: { sourceSampleFormat?: string }
      }
      expect(rawAudioBody.sourceId).toBe('audio:microphone:segment-1')
      expect(rawAudioBody.audioPath).toBe('audio/segments/segment-1.wav')
      expect(rawAudioBody.metadataPath).toBe('audio/segments/segment-1.json')
      expect(rawAudioBody.durationMs).toBe(500)
      expect(rawAudioBody.rms).toBe(0.1234)
      expect(rawAudioBody.peak).toBe(0.9876)
      expect(rawAudioBody.active).toBe(true)
      expect(rawAudioBody.vadStatus).toBe('not-implemented')
      expect(rawAudioBody.asrStatus).toBe('not-implemented')
      expect(rawAudioBody.speakerStatus).toBe('not-implemented')
      expect(rawAudioBody.metadata.sourceSampleFormat).toBe('f32')

      const updatedRawAudioResponse = await requestJson(app, '/chronicle/audio-raw-segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'audio:microphone:segment-1',
          recordedAt: '2026-05-21T10:51:00Z',
          audioPath: 'audio/segments/segment-1.wav',
          metadataPath: 'audio/segments/segment-1.json',
          sampleRate: 16_000,
          channels: 1,
          sampleCount: 16_000,
          droppedSamples: 0,
          durationMs: 900,
          rms: 0.2,
          peak: 0.4,
          active: false,
          vadImplemented: true,
          asrImplemented: true,
          speakerLabelingImplemented: true,
          metadata: { updated: true },
        }),
      })
      expect(updatedRawAudioResponse.status).toBe(200)
      const updatedRawAudioBody = await updatedRawAudioResponse.json() as {
        id: string
        durationMs: number
        active: boolean
        vadStatus: string
        asrStatus: string
        speakerStatus: string
      }
      expect(updatedRawAudioBody.id).toBe(rawAudioBody.id)
      expect(updatedRawAudioBody.durationMs).toBe(900)
      expect(updatedRawAudioBody.active).toBe(false)
      expect(updatedRawAudioBody.vadStatus).toBe('pending')
      expect(updatedRawAudioBody.asrStatus).toBe('pending')
      expect(updatedRawAudioBody.speakerStatus).toBe('pending')
      const rawAudioProcessingResponse = await requestJson(app, '/chronicle/audio-raw-segments/audio%3Amicrophone%3Asegment-1/processing-result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vadStatus: 'ready',
          asrStatus: 'ready',
          speakerStatus: 'ready',
          transcriptSourceId: 'meeting-source-1',
          speakerProfileIds: [manualSpeakerProfile.displayName],
          metadata: { runtime: 'local-audio-pipeline' },
        }),
      })
      expect(rawAudioProcessingResponse.status).toBe(200)
      const rawAudioProcessingBody = await rawAudioProcessingResponse.json() as {
        status: string
        vadStatus: string
        asrStatus: string
        speakerStatus: string
        metadata: { processingResult?: { transcriptSourceId?: string }, runtime?: string }
      }
      expect(rawAudioProcessingBody.status).toBe('processed')
      expect(rawAudioProcessingBody.vadStatus).toBe('ready')
      expect(rawAudioProcessingBody.asrStatus).toBe('ready')
      expect(rawAudioProcessingBody.speakerStatus).toBe('ready')
      expect(rawAudioProcessingBody.metadata.runtime).toBe('local-audio-pipeline')
      expect(rawAudioProcessingBody.metadata.processingResult?.transcriptSourceId).toBe('meeting-source-1')
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_raw_segments WHERE source_id = 'audio:microphone:segment-1'`)?.count).toBe(1)
      const rawAudioActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.audioRawSegmentIds?.includes(rawAudioBody.id)
        })
      expect(rawAudioActivitySegment?.segmentType).toBe('audio')
      expect(rawAudioActivitySegment?.frontApp).toBe('microphone')

      const rawAudioListResponse = await requestJson(app, '/chronicle/audio-raw-segments?limit=5')
      expect(rawAudioListResponse.status).toBe(200)
      const rawAudioList = await rawAudioListResponse.json() as Array<{ sourceId: string, recordedAtUnix: number }>
      expect(rawAudioList[0].sourceId).toBe('audio:microphone:segment-1')
      expect(rawAudioList[0].recordedAtUnix).toBe(1779360660)
      expect(db().select().from(chronicleAudioRawSegments).where(eq(chronicleAudioRawSegments.sourceId, 'audio:microphone:segment-1')).all()).toHaveLength(1)

      const invalidRawAudioTimestampResponse = await requestJson(app, '/chronicle/audio-raw-segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'audio:microphone:invalid-time',
          recordedAt: 'not-a-date',
          audioPath: 'audio/segments/invalid.wav',
          metadataPath: 'audio/segments/invalid.json',
          sampleRate: 16_000,
          channels: 1,
          sampleCount: 1,
          rms: 0,
          peak: 0,
          active: false,
        }),
      })
      expect(invalidRawAudioTimestampResponse.status).toBe(400)

      const blankRawAudioTimestampResponse = await requestJson(app, '/chronicle/audio-raw-segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'audio:microphone:blank-time',
          recordedAt: ' ',
          audioPath: 'audio/segments/blank.wav',
          metadataPath: 'audio/segments/blank.json',
          sampleRate: 16_000,
          channels: 1,
          sampleCount: 1,
          rms: 0,
          peak: 0,
          active: false,
        }),
      })
      expect(blankRawAudioTimestampResponse.status).toBe(400)

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
      expect(mixedTimeline.some(entry => entry.sourceType === 'audio' && entry.ocrText?.includes('AudioTargetBeta'))).toBe(true)

      const slackSearchResponse = await requestJson(app, '/chronicle/memories/search?q=SlackTargetAlpha&limit=5')
      expect(slackSearchResponse.status).toBe(200)
      const slackSearchResults = await slackSearchResponse.json() as Array<{ content: string }>
      expect(slackSearchResults.length).toBeGreaterThanOrEqual(1)
      expect(slackSearchResults[0].content).toContain('SlackTargetAlpha')
      const slackMemory = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, `slack:${source.id}:C123:1779303000.000100`)).get()
      const slackActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.messageIds?.includes(message!.id)
        })
      expect(slackActivitySegment?.segmentType).toBe('chat')
      expect(slackActivitySegment?.frontApp).toBe('slack')
      expect(slackActivitySegment?.title).toBe('chronicle-lab')
      const slackActivityRefs = readJson<Record<string, string[]>>(slackActivitySegment!.sourceRefsJson, {})
      expect(slackActivityRefs.messageIds).toEqual([message!.id])
      expect(slackActivityRefs.memoryIds).toEqual([slackMemory!.id])

      const activitySegmentsResponse = await requestJson(app, '/chronicle/activity-segments?limit=80')
      expect(activitySegmentsResponse.status).toBe(200)
      const activitySegments = await activitySegmentsResponse.json() as Array<{
        id: string
        segmentType: string
        sourceCounts: Record<string, number>
        sourceRefs: Record<string, string[]>
        pipelineStatus: string
      }>
      expect(activitySegments.some(segment => segment.id === snapshotActivitySegment?.id && segment.sourceRefs.snapshotIds?.includes(snapshot!.id))).toBe(true)
      expect(activitySegments.some(segment => segment.id === slackActivitySegment?.id && segment.sourceRefs.messageIds?.includes(message!.id))).toBe(true)
      expect(activitySegments.some(segment => segment.id === rawAudioActivitySegment?.id && segment.sourceRefs.audioRawSegmentIds?.includes(rawAudioBody.id))).toBe(true)
      expect(activitySegments.every(segment => segment.pipelineStatus === 'collecting')).toBe(true)

      const pipelineRunsResponse = await requestJson(app, '/chronicle/pipeline-runs?limit=80')
      expect(pipelineRunsResponse.status).toBe(200)
      const pipelineRuns = await pipelineRunsResponse.json() as Array<{
        trigger: string
        stage: string
        status: string
        segmentsCount: number
      }>
      expect(pipelineRuns.some(run => run.trigger === 'snapshot' && run.stage === 'segmentation' && run.status === 'running')).toBe(true)
      expect(pipelineRuns.some(run => run.trigger === 'message' && run.segmentsCount === 1)).toBe(true)
      expect(pipelineRuns.some(run => run.trigger === 'audio-transcript' && run.segmentsCount === 1)).toBe(true)
      expect(pipelineRuns.some(run => run.trigger === 'audio-raw' && run.segmentsCount === 1)).toBe(true)

      const unconfiguredTriageResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/triage`, { method: 'POST' })
      expect(unconfiguredTriageResponse.status).toBe(200)
      const unconfiguredTriage = await unconfiguredTriageResponse.json() as {
        status: string
        message: string
        segment: { pipelineStatus: string }
        run: { status: string, stage: string, errorMessage: string | null }
      }
      expect(unconfiguredTriage.status).toBe('error')
      expect(unconfiguredTriage.message).toBe('Chronicle is not enabled')
      expect(unconfiguredTriage.segment.pipelineStatus).toBe('error')
      expect(unconfiguredTriage.run.status).toBe('error')
      expect(unconfiguredTriage.run.stage).toBe('triage')
      expect(unconfiguredTriage.run.errorMessage).toBe('Chronicle is not enabled')

      const profileSecretResponse = await requestJson(app, '/secrets/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'provider.api-key',
          label: 'Chronicle profile key',
          secret: 'sk-chronicle-test',
        }),
      })
      expect(profileSecretResponse.status).toBe(200)
      const profileSecret = await profileSecretResponse.json() as { id: string }
      const profileResponse = await requestJson(app, '/profiles/profile-chronicle-pipeline', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Chronicle Pipeline',
          providerKind: 'openai-compatible',
          enabled: true,
          config: { baseUrl: 'https://example.com/v1', model: 'chronicle-test-model' },
          credentialRef: profileSecret.id,
        }),
      })
      expect(profileResponse.status).toBe(200)
      writeChroniclePreference(dataDir, storageRoot, {
        profileId: 'profile-chronicle-pipeline',
        modelId: 'chronicle-test-model',
        enabled: true,
        audioCaptureEnabled: true,
      })

      mockedGenerateText
        .mockResolvedValueOnce({
          text: JSON.stringify({
            keep: true,
            reason: 'Contains concrete Chronicle implementation work.',
            segmentType: 'work',
            title: 'Chronicle implementation',
            priority: 'high',
          }),
          usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
        } as Awaited<ReturnType<typeof generateText>>)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            title: 'Chronicle implementation summary',
            summary: 'TargetAlpha work was captured from the active Cradle Chronicle window.',
            keyPoints: ['TargetAlpha appears in OCR evidence', 'The segment is useful for future search'],
            entities: ['TargetAlpha', 'Cradle Chronicle'],
            followUps: ['Continue Chronicle pipeline implementation'],
          }),
          usage: { inputTokens: 13, outputTokens: 9, totalTokens: 22 },
        } as Awaited<ReturnType<typeof generateText>>)

      const triageResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/triage`, { method: 'POST' })
      expect(triageResponse.status).toBe(200)
      const triageBody = await triageResponse.json() as {
        status: string
        message: string
        segment: { pipelineStatus: string, segmentType: string, title: string | null, metadata: { triage?: { evidenceHash?: string } } }
        run: { status: string, stage: string, metadata: { evidenceHash?: string } }
      }
      expect(triageBody.status).toBe('success')
      expect(triageBody.segment.pipelineStatus).toBe('triaged')
      expect(triageBody.segment.title).toBe('Chronicle implementation')
      expect(triageBody.segment.metadata.triage?.evidenceHash).toBeTruthy()
      expect(triageBody.run.status).toBe('success')
      expect(triageBody.run.stage).toBe('triage')
      expect(triageBody.run.metadata.evidenceHash).toBe(triageBody.segment.metadata.triage?.evidenceHash)

      const activitySummarizeResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/summarize`, { method: 'POST' })
      expect(activitySummarizeResponse.status).toBe(200)
      const activitySummarizeBody = await activitySummarizeResponse.json() as {
        status: string
        memoryId: string | null
        segment: { pipelineStatus: string, summary: string | null, metadata: { summarization?: { memoryId?: string, evidenceHash?: string } } }
        run: { status: string, stage: string, memoriesCount: number, metadata: { evidenceHash?: string } }
      }
      expect(activitySummarizeBody.status).toBe('success')
      expect(activitySummarizeBody.memoryId).toBeTruthy()
      expect(activitySummarizeBody.segment.pipelineStatus).toBe('summarized')
      expect(activitySummarizeBody.segment.summary).toContain('TargetAlpha work')
      expect(activitySummarizeBody.segment.metadata.summarization?.memoryId).toBe(activitySummarizeBody.memoryId)
      expect(activitySummarizeBody.run.status).toBe('success')
      expect(activitySummarizeBody.run.stage).toBe('summarization')
      expect(activitySummarizeBody.run.memoriesCount).toBe(1)
      expect(mockedGenerateText).toHaveBeenCalledTimes(2)

      const summarizedMemory = db().select().from(chronicleMemories).where(eq(chronicleMemories.id, activitySummarizeBody.memoryId!)).get()
      expect(summarizedMemory?.sourceId).toBe(`activity-segment:${snapshotActivitySegment!.id}:summary`)
      expect(summarizedMemory?.content).toContain('TargetAlpha work')
      const segmentCountAfterSummary = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments`)?.count ?? 0
      const duplicateSummarizeResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/summarize`, { method: 'POST' })
      expect(duplicateSummarizeResponse.status).toBe(200)
      const duplicateSummarizeBody = await duplicateSummarizeResponse.json() as { status: string, memoryId: string | null, run: { status: string } }
      expect(duplicateSummarizeBody.status).toBe('success')
      expect(duplicateSummarizeBody.memoryId).toBe(activitySummarizeBody.memoryId)
      expect(duplicateSummarizeBody.run.status).toBe('success')
      expect(mockedGenerateText).toHaveBeenCalledTimes(2)
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments`)?.count).toBe(segmentCountAfterSummary)
      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_pipeline_runs WHERE source_key LIKE ${`activity-segment:${snapshotActivitySegment!.id}:summarization:%`}`)?.count).toBe(1)

      mockedGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          summary: 'TargetAlpha became durable Chronicle knowledge.',
          knowledgeCards: [
            {
              title: 'TargetAlpha Chronicle work',
              content: 'TargetAlpha work was captured in the active Cradle Chronicle window and should remain searchable for future implementation.',
              type: 'decision',
              dimension: 'technical',
              confidence: 0.91,
              tags: ['TargetAlpha', 'Chronicle'],
              stableKey: 'targetalpha-chronicle-work',
            },
          ],
          rejectedCount: 0,
        }),
        usage: { inputTokens: 17, outputTokens: 11, totalTokens: 28 },
      } as Awaited<ReturnType<typeof generateText>>)

      const crystallizeResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/crystallize`, { method: 'POST' })
      expect(crystallizeResponse.status).toBe(200)
      const crystallizeBody = await crystallizeResponse.json() as {
        status: string
        knowledgeCards: Array<{ id: string, title: string, version: number, dimension: string, cardType: string }>
        segment: { pipelineStatus: string, isCrystallized: boolean }
        run: { status: string, stage: string }
      }
      expect(crystallizeBody.status).toBe('success')
      expect(crystallizeBody.segment.pipelineStatus).toBe('crystallized')
      expect(crystallizeBody.segment.isCrystallized).toBe(true)
      expect(crystallizeBody.run.stage).toBe('crystallization')
      expect(crystallizeBody.knowledgeCards).toHaveLength(1)
      expect(crystallizeBody.knowledgeCards[0].title).toBe('TargetAlpha Chronicle work')
      expect(crystallizeBody.knowledgeCards[0].version).toBe(1)
      expect(crystallizeBody.knowledgeCards[0].dimension).toBe('technical')
      expect(crystallizeBody.knowledgeCards[0].cardType).toBe('decision')
      expect(mockedGenerateText).toHaveBeenCalledTimes(3)

      const knowledgeRows = db().select().from(chronicleKnowledgeCards).all()
      expect(knowledgeRows).toHaveLength(1)
      expect(knowledgeRows[0].stableKey).toBe('targetalpha-chronicle-work')
      expect(knowledgeRows[0].confidenceBps).toBe(9100)
      expect(readJson<string[]>(knowledgeRows[0].sourceSegmentIdsJson, [])).toContain(snapshotActivitySegment!.id)
      expect(readJson<string[]>(knowledgeRows[0].sourceMemoryIdsJson, [])).toContain(activitySummarizeBody.memoryId!)
      expect(db().select().from(chronicleKnowledgeVersions).where(eq(chronicleKnowledgeVersions.knowledgeId, knowledgeRows[0].id)).all()).toHaveLength(1)
      expect(db().select().from(chronicleKnowledgeSources).where(eq(chronicleKnowledgeSources.knowledgeId, knowledgeRows[0].id)).all().length).toBeGreaterThanOrEqual(2)

      const knowledgeListResponse = await requestJson(app, '/chronicle/knowledge-cards?limit=10')
      expect(knowledgeListResponse.status).toBe(200)
      const knowledgeList = await knowledgeListResponse.json() as Array<{ id: string, title: string, tags: string[] }>
      expect(knowledgeList).toHaveLength(1)
      expect(knowledgeList[0].title).toBe('TargetAlpha Chronicle work')
      expect(knowledgeList[0].tags).toContain('TargetAlpha')

      const versionsResponse = await requestJson(app, `/chronicle/knowledge-cards/${knowledgeRows[0].id}/versions`)
      expect(versionsResponse.status).toBe(200)
      const versions = await versionsResponse.json() as Array<{ knowledgeId: string, version: number }>
      expect(versions).toHaveLength(1)
      expect(versions[0]).toMatchObject({ knowledgeId: knowledgeRows[0].id, version: 1 })

      const duplicateCrystallizeResponse = await requestJson(app, `/chronicle/activity-segments/${snapshotActivitySegment!.id}/crystallize`, { method: 'POST' })
      expect(duplicateCrystallizeResponse.status).toBe(200)
      const duplicateCrystallizeBody = await duplicateCrystallizeResponse.json() as { status: string, knowledgeCards: Array<{ id: string }> }
      expect(duplicateCrystallizeBody.status).toBe('success')
      expect(duplicateCrystallizeBody.knowledgeCards[0].id).toBe(knowledgeRows[0].id)
      expect(mockedGenerateText).toHaveBeenCalledTimes(3)
      expect(db().select().from(chronicleKnowledgeCards).all()).toHaveLength(1)
      expect(db().select().from(chronicleKnowledgeVersions).where(eq(chronicleKnowledgeVersions.knowledgeId, knowledgeRows[0].id)).all()).toHaveLength(1)

      const schedulerSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-scheduler',
          displayId: 1,
          frameIndex: 10,
          capturedAt: '2026-05-21T10:02:00Z',
          segmentDir: '1/20260521100200',
          framePath: '1/20260521100200/frame-00010.jpg',
          ocrText: 'SchedulerTargetAlpha should advance through automatic Chronicle pipeline ticks.',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Scheduler',
        }),
      })
      expect(schedulerSnapshotResponse.status).toBe(200)
      const schedulerSnapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-scheduler')).get()
      const schedulerActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.snapshotIds?.includes(schedulerSnapshot!.id)
        })
      expect(schedulerActivitySegment?.pipelineStatus).toBe('collecting')
      db().update(chronicleActivitySegments).set({
        startedAt: 1,
        endedAt: 2,
        updatedAt: 2,
      }).where(eq(chronicleActivitySegments.id, schedulerActivitySegment!.id)).run()
      writeChroniclePreference(dataDir, storageRoot, {
        profileId: 'profile-chronicle-pipeline',
        modelId: 'chronicle-test-model',
        enabled: true,
        activityPipelineEnabled: true,
        activityPipelineBatchSize: 1,
        audioCaptureEnabled: true,
      })

      mockedGenerateText
        .mockResolvedValueOnce({
          text: JSON.stringify({
            keep: true,
            reason: 'Automatic scheduler evidence should be retained.',
            segmentType: 'work',
            title: 'Chronicle automatic scheduler',
            priority: 'medium',
          }),
          usage: { inputTokens: 19, outputTokens: 8, totalTokens: 27 },
        } as Awaited<ReturnType<typeof generateText>>)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            title: 'Chronicle scheduler summary',
            summary: 'SchedulerTargetAlpha advanced through the automatic Chronicle pipeline.',
            keyPoints: ['SchedulerTargetAlpha was captured', 'The automatic tick performed summarization'],
            entities: ['SchedulerTargetAlpha'],
            followUps: ['Keep automatic activity pipeline enabled'],
          }),
          usage: { inputTokens: 23, outputTokens: 12, totalTokens: 35 },
        } as Awaited<ReturnType<typeof generateText>>)
        .mockResolvedValueOnce({
          text: JSON.stringify({
            summary: 'SchedulerTargetAlpha became durable scheduler knowledge.',
            knowledgeCards: [
              {
                title: 'SchedulerTargetAlpha automatic pipeline',
                content: 'SchedulerTargetAlpha advanced from raw activity evidence into durable Chronicle knowledge through automatic ticks.',
                type: 'insight',
                dimension: 'technical',
                confidence: 0.87,
                tags: ['SchedulerTargetAlpha', 'Chronicle'],
                stableKey: 'schedulertargetalpha-automatic-pipeline',
              },
            ],
            rejectedCount: 0,
          }),
          usage: { inputTokens: 29, outputTokens: 16, totalTokens: 45 },
        } as Awaited<ReturnType<typeof generateText>>)

      const collectingTickResponse = await requestJson(app, '/chronicle/activity-pipeline/tick', { method: 'POST' })
      expect(collectingTickResponse.status).toBe(200)
      expect(await collectingTickResponse.json()).toMatchObject({
        checked: 1,
        triaged: 1,
        summarized: 0,
        crystallized: 0,
        skipped: 0,
        errors: 0,
      })
      expect(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, schedulerActivitySegment!.id)).get()?.pipelineStatus).toBe('triaged')

      const triagedTickResponse = await requestJson(app, '/chronicle/activity-pipeline/tick', { method: 'POST' })
      expect(triagedTickResponse.status).toBe(200)
      expect(await triagedTickResponse.json()).toMatchObject({
        checked: 1,
        triaged: 0,
        summarized: 1,
        crystallized: 0,
        skipped: 0,
        errors: 0,
      })
      const schedulerSummarySegment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, schedulerActivitySegment!.id)).get()
      expect(schedulerSummarySegment?.pipelineStatus).toBe('summarized')
      expect(schedulerSummarySegment?.summary).toContain('SchedulerTargetAlpha advanced')

      const summarizedTickResponse = await requestJson(app, '/chronicle/activity-pipeline/tick', { method: 'POST' })
      expect(summarizedTickResponse.status).toBe(200)
      expect(await summarizedTickResponse.json()).toMatchObject({
        checked: 1,
        triaged: 0,
        summarized: 0,
        crystallized: 1,
        skipped: 0,
        errors: 0,
      })
      const schedulerCrystallizedSegment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, schedulerActivitySegment!.id)).get()
      expect(schedulerCrystallizedSegment?.pipelineStatus).toBe('crystallized')
      expect(schedulerCrystallizedSegment?.isCrystallized).toBe(true)
      expect(db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.stableKey, 'schedulertargetalpha-automatic-pipeline')).all()).toHaveLength(1)
      expect(mockedGenerateText).toHaveBeenCalledTimes(6)

      const disabledSchedulerSnapshotResponse = await requestJson(app, '/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'snapshot-source-scheduler-disabled',
          displayId: 1,
          frameIndex: 11,
          capturedAt: '2026-05-21T10:03:00Z',
          segmentDir: '1/20260521100300',
          framePath: '1/20260521100300/frame-00011.jpg',
          ocrText: 'SchedulerDisabledAlpha should not advance while automatic pipeline is disabled.',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Scheduler Disabled',
        }),
      })
      expect(disabledSchedulerSnapshotResponse.status).toBe(200)
      const disabledSchedulerSnapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'snapshot-source-scheduler-disabled')).get()
      const disabledSchedulerActivitySegment = db()
        .select()
        .from(chronicleActivitySegments)
        .all()
        .find((segment) => {
          const refs = readJson<Record<string, string[]>>(segment.sourceRefsJson, {})
          return refs.snapshotIds?.includes(disabledSchedulerSnapshot!.id)
        })
      expect(disabledSchedulerActivitySegment?.pipelineStatus).toBe('collecting')
      db().update(chronicleActivitySegments).set({
        startedAt: 3,
        endedAt: 4,
        updatedAt: 4,
      }).where(eq(chronicleActivitySegments.id, disabledSchedulerActivitySegment!.id)).run()
      writeChroniclePreference(dataDir, storageRoot, {
        profileId: 'profile-chronicle-pipeline',
        modelId: 'chronicle-test-model',
        enabled: true,
        activityPipelineEnabled: false,
        activityPipelineBatchSize: 1,
        audioCaptureEnabled: true,
      })
      const disabledTickResponse = await requestJson(app, '/chronicle/activity-pipeline/tick', { method: 'POST' })
      expect(disabledTickResponse.status).toBe(200)
      expect(await disabledTickResponse.json()).toEqual({
        checked: 0,
        triaged: 0,
        summarized: 0,
        crystallized: 0,
        skipped: 0,
        errors: 0,
      })
      expect(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, disabledSchedulerActivitySegment!.id)).get()?.pipelineStatus).toBe('collecting')
      expect(mockedGenerateText).toHaveBeenCalledTimes(6)
      writeChroniclePreference(dataDir, storageRoot, {
        profileId: 'profile-chronicle-pipeline',
        modelId: 'chronicle-test-model',
        enabled: true,
        activityPipelineEnabled: true,
        activityPipelineBatchSize: 1,
        audioCaptureEnabled: true,
      })

      db().insert(chronicleKnowledgeCards).values({
        id: 'knowledge-targetalpha-duplicate',
        workspaceId: knowledgeRows[0].workspaceId,
        title: 'TargetAlpha implementation duplicate',
        content: 'TargetAlpha work was captured in the active Cradle Chronicle window and should remain searchable for future implementation.',
        cardType: 'decision',
        dimension: 'technical',
        confidenceBps: 8800,
        sourceMemoryIdsJson: '[]',
        sourceSegmentIdsJson: '[]',
        sourceChunkIdsJson: '[]',
        tagsJson: JSON.stringify(['TargetAlpha']),
        stableKey: 'targetalpha-chronicle-work-duplicate',
        contentHash: 'targetalpha-duplicate-hash',
        version: 1,
        status: 'active',
        mergedIntoId: null,
        pinned: false,
        sortOrder: 0,
        metadataJson: '{}',
        createdAt: 1779362000,
        updatedAt: 1779362000,
      }).run()

      const dreamResponse = await requestJson(app, '/chronicle/dream-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runType: 'dry-run', dryRun: true, similarityThreshold: 0.6, limit: 10 }),
      })
      expect(dreamResponse.status).toBe(200)
      const dreamRun = await dreamResponse.json() as { status: string, inputCount: number, outputCount: number, mergedCount: number, result: { candidateCount?: number, vectorMode?: string } }
      expect(dreamRun.status).toBe('completed')
      expect(dreamRun.inputCount).toBeGreaterThanOrEqual(2)
      expect(dreamRun.outputCount).toBeGreaterThanOrEqual(1)
      expect(dreamRun.mergedCount).toBe(0)
      expect(dreamRun.result.vectorMode).toBe('chronicle-lexical/v1')
      expect(dreamRun.result.candidateCount).toBeGreaterThanOrEqual(1)
      expect(db().select().from(chronicleDreamRuns).all()).toHaveLength(1)
      expect(db().select().from(chronicleDreamCandidates).all().length).toBeGreaterThanOrEqual(1)
      expect(db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.status, 'merged')).all()).toHaveLength(0)

      const statusResponse = await requestJson(app, '/chronicle/status')
      expect(statusResponse.status).toBe(200)
      const status = await statusResponse.json() as {
        totalMessages: number
        lastMessageAt: number | null
        totalAccessibilitySnapshots: number
        lastAccessibilitySnapshotAt: number | null
        totalAudioTranscripts: number
        lastAudioTranscriptAt: number | null
        totalAudioRawSegments: number
        lastAudioRawSegmentAt: number | null
        totalActivitySegments: number
        lastActivitySegmentAt: number | null
        totalPipelineRuns: number
        lastPipelineRunAt: number | null
        totalKnowledgeCards: number
        totalDreamRuns: number
        activityPipelineEnabled: boolean
        activityPipelineRunning: boolean
        activityPipelineIntervalMs: number
        activityPipelineBatchSize: number
        audioCaptureEnabled: boolean
        audioRuntimeStatus: string
      }
      expect(status.totalMessages).toBe(1)
      expect(status.lastMessageAt).toBe(1779303000)
      expect(status.totalAccessibilitySnapshots).toBe(3)
      expect(status.lastAccessibilitySnapshotAt).toBe(1779357660)
      expect(status.totalAudioTranscripts).toBe(1)
      expect(status.lastAudioTranscriptAt).toBe(1779359400)
      expect(status.totalAudioRawSegments).toBe(1)
      expect(status.lastAudioRawSegmentAt).toBe(1779360660)
      expect(status.totalActivitySegments).toBeGreaterThanOrEqual(4)
      expect(status.lastActivitySegmentAt).toBeGreaterThanOrEqual(1779360660)
      expect(status.totalPipelineRuns).toBeGreaterThanOrEqual(4)
      expect(status.lastPipelineRunAt).toBeGreaterThanOrEqual(1779360660)
      expect(status.totalKnowledgeCards).toBe(3)
      expect(status.totalDreamRuns).toBe(1)
      expect(status.activityPipelineEnabled).toBe(true)
      expect(status.activityPipelineRunning).toBe(false)
      expect(status.activityPipelineIntervalMs).toBe(120_000)
      expect(status.activityPipelineBatchSize).toBe(1)
      expect(status.audioCaptureEnabled).toBe(true)
      expect(status.audioRuntimeStatus).toBe('unavailable')

      const signingSecretValue = 'slack-signing-secret'
      const signingSecretResponse = await requestJson(app, '/secrets/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'chronicle.slack.signing-secret',
          label: 'Slack signing secret',
          secret: signingSecretValue,
        }),
      })
      expect(signingSecretResponse.status).toBe(200)
      const signingSecret = await signingSecretResponse.json() as { id: string }

      const realtimeSourceResponse = await requestJson(app, '/chronicle/message-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'slack',
          label: 'Slack Events Lab',
          enabled: true,
          botTokenRef: secret.id,
          channelIds: ['C456'],
          realtimeMode: 'events-api',
          signingSecretRef: signingSecret.id,
        }),
      })
      expect(realtimeSourceResponse.status).toBe(200)
      const realtimeSource = await realtimeSourceResponse.json() as {
        id: string
        realtimeMode: string
        signingSecretRef: string
      }
      expect(realtimeSource.realtimeMode).toBe('events-api')
      expect(realtimeSource.signingSecretRef).toBe(signingSecret.id)

      const verificationResponse = await postSignedSlackEvent(app, realtimeSource.id, {
        type: 'url_verification',
        challenge: 'challenge-token',
      }, signingSecretValue)
      expect(verificationResponse.status).toBe(200)
      expect(verificationResponse.headers.get('content-type')).toContain('text/plain')
      expect(await verificationResponse.text()).toBe('challenge-token')

      const invalidSignatureResponse = await postSignedSlackEvent(app, realtimeSource.id, {
        type: 'event_callback',
        team_id: 'T123',
        event: {
          type: 'message',
          channel: 'C456',
          ts: '1779305000.000200',
          user: 'U456',
          username: 'Grace',
          text: 'Invalid signature should not import this SlackRealtimeBlocked text.',
        },
      }, signingSecretValue, { signature: 'v0=invalid' })
      expect(invalidSignatureResponse.status).toBe(401)

      const staleTimestamp = Math.floor(Date.now() / 1000) - 600
      const staleTimestampResponse = await postSignedSlackEvent(app, realtimeSource.id, {
        type: 'event_callback',
        team_id: 'T123',
        event: {
          type: 'message',
          channel: 'C456',
          ts: '1779305050.000250',
          user: 'U456',
          username: 'Grace',
          text: 'Stale timestamp should not import this SlackRealtimeStale text.',
        },
      }, signingSecretValue, { timestamp: staleTimestamp })
      expect(staleTimestampResponse.status).toBe(401)

      const outsideChannelResponse = await postSignedSlackEvent(app, realtimeSource.id, {
        type: 'event_callback',
        team_id: 'T123',
        event: {
          type: 'message',
          channel: 'C999',
          ts: '1779305100.000300',
          user: 'U456',
          username: 'Grace',
          text: 'SlackRealtimeOutside should be ignored by channel allowlist.',
        },
      }, signingSecretValue)
      expect(outsideChannelResponse.status).toBe(200)
      const outsideChannelBody = await outsideChannelResponse.json() as { status: string, ingested: number }
      expect(outsideChannelBody.status).toBe('ignored')
      expect(outsideChannelBody.ingested).toBe(0)

      const eventPayload = {
        type: 'event_callback',
        team_id: 'T123',
        event: {
          type: 'message',
          channel: 'C456',
          ts: '1779305200.000400',
          user: 'U456',
          username: 'Grace',
          text: 'SlackRealtimeAlpha should become a Chronicle realtime memory.',
          thread_ts: '1779305200.000400',
        },
      }
      const eventResponse = await postSignedSlackEvent(app, realtimeSource.id, eventPayload, signingSecretValue)
      expect(eventResponse.status).toBe(200)
      const eventBody = await eventResponse.json() as { status: string, ingested: number }
      expect(eventBody.status).toBe('ok')
      expect(eventBody.ingested).toBe(1)

      const duplicateEventResponse = await postSignedSlackEvent(app, realtimeSource.id, eventPayload, signingSecretValue)
      expect(duplicateEventResponse.status).toBe(200)
      const duplicateEventBody = await duplicateEventResponse.json() as { status: string, ingested: number }
      expect(duplicateEventBody.status).toBe('ok')
      expect(duplicateEventBody.ingested).toBe(0)

      expect(db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_messages WHERE source_id = ${realtimeSource.id}`)?.count).toBe(1)
      const realtimeMessageSource = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, realtimeSource.id)).get()
      expect(realtimeMessageSource?.teamId).toBe('T123')
      expect(realtimeMessageSource?.lastMessageAt).toBe(1779305200)
      expect(JSON.stringify(realtimeMessageSource)).not.toContain(signingSecretValue)

      const realtimeSearchResponse = await requestJson(app, '/chronicle/memories/search?q=SlackRealtimeAlpha&limit=5')
      expect(realtimeSearchResponse.status).toBe(200)
      const realtimeSearchResults = await realtimeSearchResponse.json() as Array<{ content: string }>
      expect(realtimeSearchResults.length).toBeGreaterThanOrEqual(1)
      expect(realtimeSearchResults[0].content).toContain('SlackRealtimeAlpha')

      fetchMock.mockRestore()
    }
    finally {
      vi.restoreAllMocks()
      stopActivityPipelineScheduler()
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
