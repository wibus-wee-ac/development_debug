import { t } from 'elysia'

export const PackCodebaseModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  packRequest: t.Object({
    style: t.Union([t.Literal('xml'), t.Literal('markdown'), t.Literal('plain')]),
    compress: t.Boolean(),
    include: t.Optional(t.String({ minLength: 1 })),
    ignore: t.Optional(t.String({ minLength: 1 })),
    removeComments: t.Optional(t.Boolean()),
    removeEmptyLines: t.Optional(t.Boolean()),
  }),

  packResult: t.Object({
    content: t.String(),
    totalFiles: t.Number(),
    totalTokens: t.Number(),
  }),
}
