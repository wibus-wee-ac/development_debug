import { t } from 'elysia'

export const PtyModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  ptyIdParams: t.Object({
    ptyId: t.String({ minLength: 1 }),
  }),

  startOrAttachBody: t.Object({
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  startOrAttachResponse: t.Object({
    sessionId: t.String(),
    running: t.Boolean(),
  }),

  startShellResponse: t.Object({
    ptyId: t.String(),
    running: t.Boolean(),
  }),

  inputBody: t.Object({
    data: t.String({ minLength: 1 }),
  }),

  resizeBody: t.Object({
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  okResponse: t.Object({
    ok: t.Literal(true),
  }),

  startShellBody: t.Object({
    ptyId: t.String({ minLength: 1 }),
    cwd: t.String({ minLength: 1 }),
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  liveChannelQuery: t.Object({
    fromSeq: t.Optional(t.Numeric({ minimum: 0 })),
  }),

  clientEvent: t.Any(),

  serverEvent: t.Any(),
}
