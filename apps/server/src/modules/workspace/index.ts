import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { WorkspaceModel } from './model'
import * as Workspace from './service'

function trimValue(value: string): string {
  return value.trim()
}

function nullableJsonResponse<T>(value: T | null): T | Response {
  if (value !== null) {
    return value
  }
  return new Response('null', { headers: { 'content-type': 'application/json' } })
}

function workspaceFileNotFound(message: string): never {
  throw new AppError({
    code: 'workspace_file_not_found',
    status: 404,
    message,
  })
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return body
}

export const workspace = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['workspace'] },
})
  .get('', () => Workspace.list(), {
    detail: {
      'summary': 'List workspaces',
      'x-cradle-cli': {
        command: ['workspace', 'list'],
      },
    },
    response: { 200: t.Array(WorkspaceModel.record) },
  })
  .post('', ({ body }) => Workspace.create({ name: trimValue(body.name), path: trimValue(body.path) }), {
    detail: {
      'summary': 'Create workspace',
      'x-cradle-cli': {
        command: ['workspace', 'create'],
      },
    },
    body: WorkspaceModel.createBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.pathExistsError },
  })
  .post('/from-directory', ({ body }) => Workspace.addFromDirectory(trimValue(body.path)), {
    detail: {
      'summary': 'Import workspace from directory',
      'x-cradle-cli': {
        command: ['workspace', 'import'],
      },
    },
    body: WorkspaceModel.importBody,
    response: { 200: WorkspaceModel.record, 409: WorkspaceModel.pathExistsError },
  })
  .get('/resolve', ({ query }) => nullableJsonResponse(Workspace.resolveByPath(trimValue(query.path))), {
    detail: {
      'summary': 'Resolve workspace by path',
      'x-cradle-cli': {
        command: ['workspace', 'resolve'],
      },
    },
    query: WorkspaceModel.resolveQuery,
    response: { 200: t.Nullable(WorkspaceModel.record) },
  })
  .get('/:id/files', ({ params }) => Workspace.getFiles(params.id), {
    detail: {
      'summary': 'List workspace files',
      'x-cradle-cli': {
        command: ['workspace', 'files'],
      },
    },
    params: WorkspaceModel.idParams,
    response: { 200: t.Array(WorkspaceModel.fileEntry) },
  })
  .get('/:id/files/content', async ({ params, query }) => {
    const content = await Workspace.getFileContent(params.id, trimValue(query.path))
    return { content }
  }, {
    detail: {
      'summary': 'Read workspace file content',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'read'],
      },
    },
    params: WorkspaceModel.idParams,
    query: WorkspaceModel.fileContentQuery,
    response: { 200: WorkspaceModel.readFileResponse },
  })
  .get('/:id/files/info', async ({ params, query }) => {
    const info = await Workspace.getFileInfo(params.id, trimValue(query.path))
    return info ?? workspaceFileNotFound('Workspace file was not found.')
  }, {
    detail: {
      summary: 'Get workspace file preview metadata',
    },
    params: WorkspaceModel.idParams,
    query: WorkspaceModel.fileInfoQuery,
    response: { 200: WorkspaceModel.fileInfoResponse },
  })
  .get('/:id/files/raw', async ({ params, query }) => {
    const result = await Workspace.getFileBytes(params.id, trimValue(query.path))
    if (!result) {
      workspaceFileNotFound('Workspace file was not found.')
    }
    return new Response(responseBody(result.bytes), {
      headers: {
        'content-type': result.info.mimeType,
        'cache-control': 'no-store',
        'content-length': String(result.bytes.byteLength),
      },
    })
  }, {
    detail: {
      summary: 'Read workspace file bytes for preview',
    },
    params: WorkspaceModel.idParams,
    query: WorkspaceModel.fileInfoQuery,
  })
  .get('/:id/files/rendition/pdf', async ({ params, query }) => {
    try {
      const result = await Workspace.getFilePdfRendition(params.id, trimValue(query.path))
      if (!result) {
        workspaceFileNotFound('Workspace file PDF rendition was not found.')
      }
      return new Response(responseBody(result.bytes), {
        headers: {
          'content-type': 'application/pdf',
          'cache-control': 'no-store',
          'content-length': String(result.bytes.byteLength),
          'x-cradle-rendition-source': result.source,
        },
      })
    }
    catch (error) {
      if (error instanceof AppError) {
        throw error
      }
      return new Response(JSON.stringify({
        code: 'workspace_file_rendition_failed',
        message: error instanceof Error ? error.message : 'Workspace file PDF rendition failed.',
      }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, {
    detail: {
      summary: 'Render workspace file as PDF for preview',
    },
    params: WorkspaceModel.idParams,
    query: WorkspaceModel.fileInfoQuery,
  })
  .put('/:id/files/content', async ({ params, body }) => {
    return Workspace.setFileContent({
      workspaceId: params.id,
      relativePath: trimValue(body.path),
      content: body.content,
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Write workspace file content',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'write'],
      },
    },
    params: WorkspaceModel.idParams,
    body: WorkspaceModel.writeFileBody,
    response: { 200: WorkspaceModel.writeFileResponse },
  })
  .post('/:id/files/file', async ({ params, body }) => {
    return Workspace.createFile({
      workspaceId: params.id,
      relativePath: trimValue(body.path),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Create workspace file',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'create'],
      },
    },
    params: WorkspaceModel.idParams,
    body: WorkspaceModel.createFileBody,
    response: { 200: WorkspaceModel.fileOperationResponse },
  })
  .post('/:id/files/folder', async ({ params, body }) => {
    return Workspace.createFolder({
      workspaceId: params.id,
      relativePath: trimValue(body.path),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Create workspace folder',
      'x-cradle-cli': {
        command: ['workspace', 'folder', 'create'],
      },
    },
    params: WorkspaceModel.idParams,
    body: WorkspaceModel.createFolderBody,
    response: { 200: WorkspaceModel.fileOperationResponse },
  })
  .patch('/:id/files/path', async ({ params, body }) => {
    return Workspace.renameFilePath({
      workspaceId: params.id,
      sourcePath: trimValue(body.sourcePath),
      destinationPath: trimValue(body.destinationPath),
      confirmedNonCradleOwnedWrite: body.confirmedNonCradleOwnedWrite,
    })
  }, {
    detail: {
      'summary': 'Rename workspace file path',
      'x-cradle-cli': {
        command: ['workspace', 'file', 'rename'],
      },
    },
    params: WorkspaceModel.idParams,
    body: WorkspaceModel.renameFileBody,
    response: { 200: WorkspaceModel.renameFileResponse },
  })
  .get('/:id', ({ params }) => nullableJsonResponse(Workspace.get(params.id)), {
    detail: {
      'summary': 'Get workspace',
      'x-cradle-cli': {
        command: ['workspace', 'get'],
      },
    },
    params: WorkspaceModel.idParams,
    response: { 200: t.Nullable(WorkspaceModel.record) },
  })
  .patch('/:id', ({ params, body }) => {
    if (body.name === undefined && body.pinned === undefined) {
      throw new AppError({
        code: 'invalid_workspace_input',
        status: 400,
        message: 'at least one of name or pinned is required',
      })
    }

    return nullableJsonResponse(Workspace.update({
      id: params.id,
      name: body.name === undefined ? undefined : trimValue(body.name),
      pinned: body.pinned,
    }))
  }, {
    detail: {
      'summary': 'Update workspace',
      'x-cradle-cli': {
        command: ['workspace', 'update'],
      },
    },
    params: WorkspaceModel.idParams,
    body: WorkspaceModel.updateBody,
    response: { 200: t.Nullable(WorkspaceModel.record) },
  })
  .delete('/:id', ({ params }) => {
    Workspace.remove(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete workspace',
      'x-cradle-cli': {
        command: ['workspace', 'delete'],
      },
    },
    params: WorkspaceModel.idParams,
    response: { 200: WorkspaceModel.deleteResponse },
  })
