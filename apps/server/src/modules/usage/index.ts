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
  .get('/cost/summary', ({ query }) => Usage.getCostSummary(query.from, query.to), {
    detail: { summary: 'Get cost summary with model breakdown' },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.costSummary },
  })
  .get('/cost/sessions', ({ query }) => Usage.getSessionsCost(query.from, query.to), {
    detail: { summary: 'Get per-session cost breakdown' },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.sessionCost },
  })
  .get('/cost/daily', ({ query }) => Usage.getDailyCost(query.from, query.to), {
    detail: { summary: 'Get daily cost trend' },
    query: UsageModel.dateRangeQuery,
    response: { 200: UsageModel.dailyCost },
  })
