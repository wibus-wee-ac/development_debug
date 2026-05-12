import { t } from 'elysia'

export const HealthModel = {
  checkResponse: t.Object({
    status: t.Literal('ok'),
    timestamp: t.Number(),
  }),
} as const
