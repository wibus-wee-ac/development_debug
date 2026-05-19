// Input: Chronicle configuration from preferences
// Output: /api/chronicle/* endpoints for Chronicle Rust daemon integration
// Position: apps/server/src/modules/chronicle module

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
  .get('/timeline', ({ query }) => Chronicle.getTimeline(query.limit), {
    detail: { summary: 'Get recent Chronicle captures', tags: ['chronicle'] },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
  })
  .get('/frame/:displayId/:segment/:frame', ({ params }) => Chronicle.getFrameImage(`${params.displayId}/${params.segment}`, params.frame), {
    detail: { summary: 'Get a captured frame image', tags: ['chronicle'] },
  })
  .get('/memories', ({ query }) => Chronicle.getMemories(query.limit), {
    detail: { summary: 'Get Chronicle AI memories/summaries', tags: ['chronicle'] },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
  })
