import { t } from 'elysia'

export const serverStatusEventSchema = t.Union([
  t.Object({
    type: t.Literal('source_sync_error'),
    data: t.Object({
      sourceKey: t.String(),
      label: t.String(),
      error: t.String(),
    }),
  }),
  t.Object({
    type: t.Literal('daemon_error'),
    data: t.Object({
      daemon: t.String(),
      error: t.String(),
    }),
  }),
])

export type ServerStatusEvent = typeof serverStatusEventSchema.static
