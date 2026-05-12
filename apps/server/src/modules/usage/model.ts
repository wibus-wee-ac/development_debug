import { t } from 'elysia'

export const UsageModel = {
  dailyUsage: t.Object({
    date: t.String(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    totalTokens: t.Number(),
    count: t.Number(),
  }),

  usageSummary: t.Object({
    totalPromptTokens: t.Number(),
    totalCompletionTokens: t.Number(),
    totalTokens: t.Number(),
    totalTurns: t.Number(),
    byAgent: t.Array(t.Object({
      agentProfileId: t.String(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
    byModel: t.Array(t.Object({
      modelId: t.String(),
      totalTokens: t.Number(),
      count: t.Number(),
    })),
  }),

  usageStats: t.Object({
    currentStreak: t.Number(),
    longestStreak: t.Number(),
    activeDays: t.Number(),
    avgDailyTokens: t.Number(),
    peakDay: t.Nullable(t.Object({
      date: t.String(),
      totalTokens: t.Number(),
    })),
    todayTokens: t.Number(),
  }),

  sessionUsage: t.Object({
    totalTokens: t.Number(),
    promptTokens: t.Number(),
    completionTokens: t.Number(),
    count: t.Number(),
  }),

  dailyQuery: t.Object({
    days: t.Optional(t.Numeric({ minimum: 1 })),
  }),

  sessionParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),
}
