import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

export const WorkspaceModel = {
  record: t.Object({
    id: t.String(),
    name: t.String(),
    path: t.String(),
    identifier: t.String(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }, { additionalProperties: false }),

  fileEntry: t.Object({
    type: t.Union([t.Literal('file'), t.Literal('directory')]),
    name: t.String(),
    path: t.String(),
  }, { additionalProperties: false }),

  createBody: t.Object({
    name: nonBlankString,
    path: nonBlankString,
  }, { additionalProperties: false }),

  importBody: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  resolveQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  updateBody: t.Object({
    name: nonBlankString,
  }, { additionalProperties: false }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  fileContentQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  writeFileBody: t.Object({
    path: nonBlankString,
    content: t.String(),
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  readFileResponse: t.Object({
    content: t.Nullable(t.String()),
  }),

  writeFileResponse: t.Object({
    success: t.Boolean(),
    ownerBoundary: t.Object({
      classification: t.Literal('non-cradle-owned'),
      owner: t.Literal('workspace'),
      consentRequired: t.Literal(true),
      consentConfirmed: t.Literal(true),
      workspacePath: t.Nullable(t.String()),
      relativePath: t.String(),
      targetPath: t.Nullable(t.String()),
    }, { additionalProperties: false }),
  }),

  deleteResponse: t.Object({
    ok: t.Literal(true),
  }),

  pathExistsError: t.Object({
    code: t.Literal('workspace_path_exists'),
    message: t.String(),
    details: t.Object({ path: t.String() }),
  }),
} as const
