import { Elysia } from 'elysia'

import { PackCodebaseModel } from './model'
import * as PackCodebase from './service'

export const packCodebase = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['pack-codebase'] },
})
  .post('/:id/pack', ({ params, body }) => PackCodebase.packWorkspace(params.id, body), {
    detail: {
      summary: 'Pack codebase',
      'x-cradle-cli': {
        command: ['workspace', 'pack'],
      },
    },
    params: PackCodebaseModel.idParams,
    body: PackCodebaseModel.packRequest,
    response: { 200: PackCodebaseModel.packResult },
  })
