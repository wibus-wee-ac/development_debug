import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })
const nullableString = t.Union([t.String(), t.Null()])

interface WorkspaceRecord {
  id: string
  name: string
  path: string
  identifier: string
  pinned: number
  createdAt: number
  updatedAt: number
}

const ownerBoundary = t.Object({
  classification: t.Literal('non-cradle-owned'),
  owner: t.Literal('workspace'),
  consentRequired: t.Literal(true),
  consentConfirmed: t.Literal(true),
  workspacePath: nullableString,
  relativePath: t.String(),
  targetPath: nullableString,
}, { additionalProperties: false })

const workspaceRecord = t.Object({
  id: t.String(),
  name: t.String(),
  path: t.String(),
  identifier: t.String(),
  pinned: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
}, { additionalProperties: false })

const nullableWorkspaceRecord = t.Union([workspaceRecord, t.Null()])

export const WorkspaceModel = {
  record: workspaceRecord,

  nullableRecord: nullableWorkspaceRecord,

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
    name: t.Optional(nonBlankString),
    pinned: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  fileContentQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  fileChildrenQuery: t.Object({
    path: t.Optional(t.String()),
  }, { additionalProperties: false }),

  fileSearchQuery: t.Object({
    q: t.Optional(t.String()),
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false }),

  fileInfoQuery: t.Object({
    path: nonBlankString,
  }, { additionalProperties: false }),

  writeFileBody: t.Object({
    path: nonBlankString,
    content: t.String(),
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  createFileBody: t.Object({
    path: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  createFolderBody: t.Object({
    path: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  renameFileBody: t.Object({
    sourcePath: nonBlankString,
    destinationPath: nonBlankString,
    confirmedNonCradleOwnedWrite: t.Boolean(),
  }, { additionalProperties: false }),

  readFileResponse: t.Object({
    content: nullableString,
  }),

  fileInfoResponse: t.Object({
    name: t.String(),
    path: t.String(),
    size: t.Number(),
    modifiedAt: t.Number(),
    mimeType: t.String(),
    extension: t.String(),
    previewKind: t.Union([
      t.Literal('text'),
      t.Literal('markdown'),
      t.Literal('image'),
      t.Literal('pdf'),
      t.Literal('office'),
      t.Literal('unsupported'),
    ]),
  }, { additionalProperties: false }),

  writeFileResponse: t.Object({
    success: t.Boolean(),
    ownerBoundary,
  }),

  fileOperationResponse: t.Object({
    success: t.Boolean(),
    ownerBoundary,
  }),

  renameFileResponse: t.Object({
    success: t.Boolean(),
    sourceBoundary: ownerBoundary,
    destinationBoundary: ownerBoundary,
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
