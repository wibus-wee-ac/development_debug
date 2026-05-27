import { Elysia, t } from 'elysia'

import { GitModel } from './model'
import * as Git from './service'

export const git = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['git'] },
})
  .get('/:id/git/status', ({ params }) => Git.getStatus(params.id), {
    detail: {
      'summary': 'Get git status',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'status'],
      },
    },
    params: GitModel.idParams,
    response: { 200: GitModel.statusView },
  })
  .get('/:id/git/branches', ({ params }) => Git.getBranches(params.id), {
    detail: {
      'summary': 'Get git branches',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'branches'],
      },
    },
    params: GitModel.idParams,
    response: { 200: GitModel.branchesView },
  })
  .get('/:id/git/remotes', ({ params }) => Git.getRemotes(params.id), {
    detail: {
      summary: 'Get git remotes',
    },
    params: GitModel.idParams,
    response: { 200: GitModel.remotesView },
  })
  .get('/:id/git/graph', ({ params, query }) => Git.getGraph(params.id, query.limit ?? 100), {
    detail: {
      'summary': 'Get git graph',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'graph'],
      },
    },
    params: GitModel.idParams,
    query: GitModel.graphQuery,
    response: { 200: t.Array(GitModel.graphCommitView) },
  })
  .post('/:id/git/checkout', async ({ params, body }) => {
    await Git.checkout(params.id, body.branch)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Checkout branch',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'checkout'],
      },
    },
    params: GitModel.idParams,
    body: GitModel.checkoutBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/:id/git/branches', async ({ params, body }) => {
    await Git.createBranch(params.id, body.name, body.from)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Create branch',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'branch', 'create'],
      },
    },
    params: GitModel.idParams,
    body: GitModel.createBranchBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/:id/git/fetch', async ({ params }) => {
    await Git.fetch(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Fetch remote',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'fetch'],
      },
    },
    params: GitModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/:id/git/diff', async ({ params, query }) => {
    const paths = query.paths ? query.paths.split(',').map(p => p.trim()).filter(Boolean) : undefined
    return await Git.getDiff(params.id, paths)
  }, {
    detail: {
      'summary': 'Get git diff',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'diff'],
      },
    },
    params: GitModel.idParams,
    query: GitModel.diffQuery,
    response: { 200: t.String() },
  })
