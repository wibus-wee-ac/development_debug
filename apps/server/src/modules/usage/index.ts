import { Elysia, t } from 'elysia'

import { UsageModel } from './model'
import * as Usage from './service'

export const usage = new Elysia({
  prefix: '/usage',
  detail: { tags: ['usage'] },
})
  .get('/daily', ({ query }) => Usage.getDailyUsage(query.days), {
    detail: { summary: 'Get daily usage' },
    query: UsageModel.dailyQuery,
    response: { 200: t.Array(UsageModel.dailyUsage) },
  })
  .get('/summary', () => Usage.getUsageSummary(), {
    detail: { summary: 'Get usage summary' },
    response: { 200: UsageModel.usageSummary },
  })
  .get('/stats', () => Usage.getUsageStats(), {
    detail: { summary: 'Get usage stats' },
    response: { 200: UsageModel.usageStats },
  })
  .get('/sessions/:sessionId', ({ params }) => Usage.getSessionUsage(params.sessionId), {
    detail: { summary: 'Get session usage' },
    params: UsageModel.sessionParams,
    response: { 200: UsageModel.sessionUsage },
  })
