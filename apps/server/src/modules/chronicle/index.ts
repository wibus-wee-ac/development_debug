import { Elysia, t } from 'elysia'

import { ChronicleModel } from './model'
import * as Chronicle from './service'

export const chronicle = new Elysia({ prefix: '/chronicle' })
  .get('/config', () => Chronicle.getConfig(), {
    detail: { summary: 'Get Chronicle daemon configuration', tags: ['chronicle'] },
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
  .put('/config', ({ body }) => Chronicle.updateConfig(body), {
    detail: { summary: 'Update Chronicle daemon configuration', tags: ['chronicle'] },
    body: ChronicleModel.config,
    response: { 200: ChronicleModel.config },
  })
  .get('/status', () => Chronicle.getStatus(), {
    detail: { summary: 'Get Chronicle daemon status', tags: ['chronicle'] },
    response: { 200: ChronicleModel.status },
  })
  .get('/resources', () => Chronicle.getDaemonResources(), {
    detail: { summary: 'Get Chronicle daemon resource usage', tags: ['chronicle'] },
  })
  .get('/daemon/resources', () => Chronicle.getDaemonResources(), {
    detail: { summary: 'Get Chronicle daemon process resource usage', tags: ['chronicle'] },
  })
  .get('/model-resources', () => Chronicle.getModelResources(), {
    detail: { summary: 'Get Chronicle local model resource status', tags: ['chronicle'] },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/reconcile', () => Chronicle.reconcileModelResources(), {
    detail: { summary: 'Reconcile Chronicle local model resources', tags: ['chronicle'] },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/:category/verify', ({ params }) => Chronicle.verifyModelResource(params.category), {
    detail: { summary: 'Verify a Chronicle local model resource', tags: ['chronicle'] },
    params: ChronicleModel.modelResourceCategoryParams,
    response: { 200: ChronicleModel.modelResource },
  })
  .post('/model-resources/:category/install', ({ params, body }) => Chronicle.installModelResource(params.category, body), {
    detail: { summary: 'Install a Chronicle local model resource', tags: ['chronicle'] },
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
    detail: { summary: 'List Chronicle message sources', tags: ['chronicle'] },
    response: { 200: t.Array(ChronicleModel.messageSource) },
  })
  .post('/message-sources', ({ body }) => Chronicle.createMessageSource(body), {
    detail: { summary: 'Create a Chronicle message source', tags: ['chronicle'] },
    body: ChronicleModel.messageSourceBody,
    response: { 200: ChronicleModel.messageSource },
  })
  .patch('/message-sources/:sourceId', ({ params, body }) => Chronicle.updateMessageSource(params.sourceId, body), {
    detail: { summary: 'Update a Chronicle message source', tags: ['chronicle'] },
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
    detail: { summary: 'Synchronize a Chronicle Slack source', tags: ['chronicle'] },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.slackSyncResponse },
  })
  .get('/messages', ({ query }) => Chronicle.listMessages(query.limit), {
    detail: { summary: 'List Chronicle message events', tags: ['chronicle'] },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.messageEntry) },
  })
  .get('/timeline', ({ query }) => Chronicle.getTimeline(query.limit), {
    detail: { summary: 'Get recent Chronicle captures', tags: ['chronicle'] },
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
    detail: { summary: 'Get Chronicle AI memories/summaries', tags: ['chronicle'] },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
  .get('/memories/search', ({ query }) => Chronicle.searchMemories(query.q, query.limit), {
    detail: { summary: 'Search Chronicle memories', tags: ['chronicle'] },
    query: t.Object({
      q: t.String({ minLength: 1 }),
      limit: t.Optional(t.Number({ default: 20 })),
    }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
