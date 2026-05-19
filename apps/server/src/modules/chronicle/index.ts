// Input: Chronicle configuration from preferences
// Output: /api/chronicle/* endpoints for Chronicle Rust daemon integration
// Position: apps/server/src/modules/chronicle module

import { Elysia } from 'elysia'

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
  .get('/status', () => Chronicle.getStatus(), {
    detail: { summary: 'Get Chronicle daemon status', tags: ['chronicle'] },
    response: { 200: ChronicleModel.status },
  })
