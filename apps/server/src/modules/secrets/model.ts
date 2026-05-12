import { t } from 'elysia'

export const SecretsModel = {
  secretMetadata: t.Object({
    id: t.String(),
    kind: t.String(),
    label: t.String(),
    maskedSecret: t.String(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  saveBody: t.Object({
    kind: t.String({ minLength: 1 }),
    label: t.String({ minLength: 1 }),
    secret: t.String({ minLength: 1 }),
  }),
}
