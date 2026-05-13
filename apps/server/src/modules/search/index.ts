import { Elysia } from 'elysia'

import { SearchModel } from './model'
import * as Search from './service'

export const search = new Elysia({
  prefix: '/search',
  detail: { tags: ['search'] },
})
  .get('/threads', ({ query }) => Search.searchThreads({
    query: query.query,
    workspaceId: query.workspaceId,
    limit: query.limit,
    snippetsPerHit: query.snippetsPerHit,
  }), {
    detail: {
      summary: 'Search threads',
      'x-cradle-cli': {
        command: ['search', 'threads'],
      },
    },
    query: SearchModel.searchQuery,
    response: { 200: SearchModel.threadSearchResponse },
  })
