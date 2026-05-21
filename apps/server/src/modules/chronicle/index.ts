import { Elysia, t } from 'elysia'

import { ChronicleModel } from './model'
import * as Chronicle from './service'

export const chronicle = new Elysia({ prefix: '/chronicle' })
  .get('/config', () => Chronicle.getConfig(), {
    detail: {
      summary: 'Get Chronicle daemon configuration',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'config', 'get'] },
    },
    response: { 200: ChronicleModel.config },
  })
  .post('/summarize', ({ body }) => Chronicle.summarize(body), {
    detail: { summary: 'Generate LLM summary from Chronicle prompt', tags: ['chronicle'] },
    body: ChronicleModel.summarizeBody,
    response: { 200: ChronicleModel.summarizeResponse },
  })
  .post('/snapshots', ({ body }) => Chronicle.recordSnapshot(body), {
    detail: { summary: 'Ingest a Chronicle snapshot report', tags: ['chronicle'] },
    body: ChronicleModel.snapshotReportBody,
  })
  .post('/memories', ({ body }) => Chronicle.recordMemory(body), {
    detail: { summary: 'Ingest a Chronicle memory report', tags: ['chronicle'] },
    body: ChronicleModel.memoryReportBody,
  })
  .put('/config', ({ body }) => Chronicle.updateConfig({
    ...body,
    audioSource: body.audioSource ?? 'microphone',
  }), {
    detail: {
      summary: 'Update Chronicle daemon configuration',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'config', 'set'] },
    },
    body: ChronicleModel.config,
    response: { 200: ChronicleModel.config },
  })
  .get('/status', () => Chronicle.getStatus(), {
    detail: {
      summary: 'Get Chronicle daemon status',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'status'] },
    },
    response: { 200: ChronicleModel.status },
  })
  .get('/resources', () => Chronicle.getDaemonResources(), {
    detail: {
      summary: 'Get Chronicle daemon resource usage',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'resources'] },
    },
    response: { 200: ChronicleModel.daemonResources },
  })
  .get('/daemon/resources', () => Chronicle.getDaemonResources(), {
    detail: {
      summary: 'Get Chronicle daemon process resource usage',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'daemon', 'resources'] },
    },
    response: { 200: ChronicleModel.daemonResources },
  })
  .get('/model-resources', () => Chronicle.getModelResources(), {
    detail: {
      summary: 'Get Chronicle local model resource status',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/reconcile', () => Chronicle.reconcileModelResources(), {
    detail: {
      summary: 'Reconcile Chronicle local model resources',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'reconcile'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/install-all', () => Chronicle.installAllModelResources(), {
    detail: {
      summary: 'Install all Chronicle model resources from manifests',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'install-all'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .get('/model-resources/download-progress', () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // Send current state
        const current = Chronicle.getDownloadProgress()
        if (current.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(current)}\n\n`))
        }
        // Subscribe to updates
        const unsubscribe = Chronicle.subscribeDownloadProgress((entry) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(entry)}\n\n`))
          } catch {
            unsubscribe()
          }
        })
        // Keep alive every 15s
        const keepAlive = setInterval(() => {
          try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { clearInterval(keepAlive) }
        }, 15000)
        // Clean up when client disconnects (controller closed)
        const checkClosed = setInterval(() => {
          try { controller.enqueue(encoder.encode('')) } catch {
            clearInterval(checkClosed)
            clearInterval(keepAlive)
            unsubscribe()
          }
        }, 5000)
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'SSE stream of model resource download progress', tags: ['chronicle'] },
  })
  .post('/model-resources/:category/verify', ({ params }) => Chronicle.verifyModelResource(params.category), {
    detail: {
      summary: 'Verify a Chronicle local model resource',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'verify'] },
    },
    params: ChronicleModel.modelResourceCategoryParams,
    response: { 200: ChronicleModel.modelResource },
  })
  .post('/model-resources/:category/install', ({ params, body }) => Chronicle.installModelResource(params.category, body), {
    detail: {
      summary: 'Install a Chronicle local model resource',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'install'] },
    },
    params: ChronicleModel.modelResourceCategoryParams,
    body: ChronicleModel.modelResourceInstallBody,
    response: { 200: ChronicleModel.modelResource },
  })
  .delete('/model-resources/:category', ({ params }) => Chronicle.removeModelResource(params.category), {
    detail: { summary: 'Remove a Chronicle local model resource', tags: ['chronicle'] },
    params: ChronicleModel.modelResourceCategoryParams,
    response: { 200: ChronicleModel.modelResource },
  })
  .get('/message-sources', () => Chronicle.listMessageSources(), {
    detail: {
      summary: 'List Chronicle message sources',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.messageSource) },
  })
  .post('/message-sources', ({ body }) => Chronicle.createMessageSource(body), {
    detail: {
      summary: 'Create a Chronicle message source',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'create'] },
    },
    body: ChronicleModel.messageSourceBody,
    response: { 200: ChronicleModel.messageSource },
  })
  .patch('/message-sources/:sourceId', ({ params, body }) => Chronicle.updateMessageSource(params.sourceId, body), {
    detail: {
      summary: 'Update a Chronicle message source',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'update'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.messageSourcePatchBody,
    response: { 200: ChronicleModel.messageSource },
  })
  .delete('/message-sources/:sourceId', ({ params }) => Chronicle.deleteMessageSource(params.sourceId), {
    detail: { summary: 'Delete a Chronicle message source', tags: ['chronicle'] },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/message-sources/:sourceId/sync', ({ params }) => Chronicle.syncSlackSource(params.sourceId), {
    detail: {
      summary: 'Synchronize a Chronicle Slack source',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'sync'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.slackSyncResponse },
  })
  .post('/message-sources/:sourceId/slack/events', async ({ params, request, headers }) => {
    const result = await Chronicle.handleSlackEvents(params.sourceId, {
      rawBody: await request.text(),
      signature: headers['x-slack-signature'] ?? null,
      timestamp: headers['x-slack-request-timestamp'] ?? null,
    })
    if (result.challenge) {
      return new Response(result.challenge, {
        headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    })
  }, {
    detail: { summary: 'Receive Slack Events API callbacks for a Chronicle source', tags: ['chronicle'] },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    parse: 'none',
  })
  .get('/messages', ({ query }) => Chronicle.listMessages(query.limit), {
    detail: {
      summary: 'List Chronicle message events',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'messages', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.messageEntry) },
  })
  .get('/audio-transcripts', ({ query }) => Chronicle.listAudioTranscripts(query.limit), {
    detail: {
      summary: 'List Chronicle audio transcripts',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-transcripts', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.audioTranscript) },
  })
  .post('/audio-transcripts', ({ body }) => Chronicle.recordAudioTranscript(body), {
    detail: { summary: 'Ingest a Chronicle audio transcript report', tags: ['chronicle'] },
    body: ChronicleModel.audioTranscriptReportBody,
    response: { 200: ChronicleModel.audioTranscript },
  })
  .get('/speaker-profiles', () => Chronicle.listSpeakerProfiles(), {
    detail: {
      summary: 'List Chronicle speaker profiles learned from transcripts',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'speaker-profiles', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.speakerProfile) },
  })
  .post('/speaker-profiles', ({ body }) => Chronicle.upsertSpeakerProfile(body), {
    detail: {
      summary: 'Create or update a Chronicle speaker profile',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'speaker-profiles', 'upsert'] },
    },
    body: ChronicleModel.speakerProfileBody,
    response: { 200: ChronicleModel.speakerProfile },
  })
  .get('/audio-raw-segments', ({ query }) => Chronicle.listAudioRawSegments(query.limit), {
    detail: {
      summary: 'List Chronicle raw audio segment artifacts',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-raw-segments', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.audioRawSegment) },
  })
  .post('/audio-raw-segments', ({ body }) => Chronicle.recordAudioRawSegment(body), {
    detail: { summary: 'Ingest a Chronicle raw audio segment artifact report', tags: ['chronicle'] },
    body: ChronicleModel.audioRawSegmentReportBody,
    response: { 200: ChronicleModel.audioRawSegment },
  })
  .post('/audio-raw-segments/:sourceId/processing-result', ({ params, body }) => Chronicle.recordAudioRawSegmentProcessingResult(params.sourceId, body), {
    detail: {
      summary: 'Record Chronicle raw audio processing results',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-raw-segments', 'processing-result'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.audioRawSegmentProcessingResultBody,
    response: { 200: ChronicleModel.audioRawSegment },
  })
  .get('/accessibility-snapshots', ({ query }) => Chronicle.listAccessibilitySnapshots(query.limit), {
    detail: {
      summary: 'List Chronicle accessibility evidence snapshots',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'accessibility-snapshots', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.accessibilitySnapshot) },
  })
  .get('/activity-segments', ({ query }) => Chronicle.listActivitySegments(query.limit), {
    detail: {
      summary: 'List Chronicle activity segments',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.activitySegment) },
  })
  .post('/activity-segments/:segmentId/triage', ({ params }) => Chronicle.triageActivitySegment(params.segmentId), {
    detail: {
      summary: 'Run Chronicle activity segment triage',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'triage'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-segments/:segmentId/summarize', ({ params }) => Chronicle.summarizeActivitySegment(params.segmentId), {
    detail: {
      summary: 'Run Chronicle activity segment summarization',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'summarize'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-segments/:segmentId/crystallize', ({ params }) => Chronicle.crystallizeActivitySegment(params.segmentId), {
    detail: {
      summary: 'Run Chronicle activity segment knowledge crystallization',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'crystallize'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-pipeline/tick', () => Chronicle.runActivityPipelineTick(), {
    detail: {
      summary: 'Run one Chronicle automatic activity pipeline tick',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-pipeline', 'tick'] },
    },
    response: { 200: ChronicleModel.activityPipelineTickResponse },
  })
  .get('/pipeline-runs', ({ query }) => Chronicle.listPipelineRuns(query.limit), {
    detail: {
      summary: 'List Chronicle activity pipeline runs',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'pipeline-runs', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.pipelineRun) },
  })
  .get('/knowledge-cards', ({ query }) => Chronicle.listKnowledgeCards({
    limit: query.limit,
    dimension: query.dimension,
    cardType: query.type,
    includeDeleted: query.includeDeleted,
  }), {
    detail: {
      summary: 'List Chronicle knowledge cards',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'list'] },
    },
    query: ChronicleModel.knowledgeCardsQuery,
    response: { 200: t.Array(ChronicleModel.knowledgeCard) },
  })
  .get('/knowledge-cards/:knowledgeId/versions', ({ params }) => Chronicle.listKnowledgeVersions(params.knowledgeId), {
    detail: {
      summary: 'List Chronicle knowledge card versions',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'versions'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    response: { 200: t.Array(ChronicleModel.knowledgeVersion) },
  })
  .get('/dream-runs', ({ query }) => Chronicle.listDreamRuns(query.limit), {
    detail: {
      summary: 'List Chronicle dream merge runs',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'dream-runs', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.dreamRun) },
  })
  .post('/dream-runs', ({ body }) => Chronicle.startDreamRun(body), {
    detail: {
      summary: 'Start a Chronicle dream merge run',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'dream-runs', 'start'] },
    },
    body: ChronicleModel.dreamStartBody,
    response: { 200: ChronicleModel.dreamRun },
  })
  .get('/timeline', ({ query }) => Chronicle.getTimeline(query.limit), {
    detail: {
      summary: 'Get recent Chronicle captures',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'timeline'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.timelineEntry) },
  })
  .get('/snapshots/:snapshotId/frame', ({ params }) => Chronicle.getFrameImageBySnapshot(params.snapshotId), {
    detail: { summary: 'Get a captured frame image by snapshot id', tags: ['chronicle'] },
  })
  .get('/frame/:displayId/:segment/:frame', ({ params }) => Chronicle.getFrameImage(`${params.displayId}/${params.segment}`, params.frame), {
    detail: { summary: 'Get a captured frame image', tags: ['chronicle'] },
  })
  .get('/memories', ({ query }) => Chronicle.getMemories(query.limit), {
    detail: {
      summary: 'Get Chronicle AI memories/summaries',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
  .get('/memories/search', ({ query }) => Chronicle.searchMemories(query.q, query.limit), {
    detail: {
      summary: 'Search Chronicle memories',
      tags: ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'search'] },
    },
    query: t.Object({
      q: t.String({ minLength: 1 }),
      limit: t.Optional(t.Number({ default: 20 })),
    }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
  .post('/embeddings', ({ body }) => Chronicle.embedTexts(body), {
    detail: { summary: 'Generate Chronicle local ONNX text embeddings', tags: ['chronicle'] },
    body: ChronicleModel.embeddingRequestBody,
    response: { 200: ChronicleModel.embeddingResponse },
  })
