import { Elysia, t } from 'elysia'

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
  .put('/:id/files/content', async ({ params, body }) => {
    const success = await Workspace.setFileContent(params.id, trimValue(body.path), body.content)
    return { success }
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
  .patch('/:id', ({ params, body }) => nullableJsonResponse(Workspace.update({ id: params.id, name: trimValue(body.name) })), {
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
