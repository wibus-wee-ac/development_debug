import { Elysia, t } from 'elysia'

import { GitModel } from './model'
import * as Git from './service'

export const git = new Elysia({
  prefix: '/workspaces',
  detail: { tags: ['git'] },
})
  .get('/:id/git/repositories', ({ params }) => Git.getRepositories(params.id), {
    detail: {
      'summary': 'Get git repositories',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'repositories'],
      },
    },
    params: GitModel.idParams,
    response: { 200: t.Array(GitModel.repositoryView) },
  })
  .get('/:id/git/status', ({ params, query }) => Git.getStatus(params.id, query.repo), {
    detail: {
      'summary': 'Get git status',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'status'],
      },
    },
    params: GitModel.idParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.statusView },
  })
  .get('/:id/git/branches', ({ params, query }) => Git.getBranches(params.id, query.repo), {
    detail: {
      'summary': 'Get git branches',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'branches'],
      },
    },
    params: GitModel.idParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.branchesView },
  })
  .get('/:id/git/remotes', ({ params, query }) => Git.getRemotes(params.id, query.repo), {
    detail: {
      summary: 'Get git remotes',
    },
    params: GitModel.idParams,
    query: GitModel.repositoryQuery,
    response: { 200: GitModel.remotesView },
  })
  .get('/:id/git/graph', ({ params, query }) => Git.getGraph(params.id, query.limit ?? 100, query.repo), {
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
    await Git.checkout(params.id, body.branch, body.repo)
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
    await Git.createBranch(params.id, body.name, body.from, body.repo)
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
  .post('/:id/git/fetch', async ({ params, body }) => {
    await Git.fetch(params.id, body?.repo)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Fetch remote',
      'x-cradle-cli': {
        command: ['workspace', 'git', 'fetch'],
      },
    },
    params: GitModel.idParams,
    body: GitModel.fetchBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/:id/git/diff', async ({ params, query }) => {
    const paths = query.paths ? query.paths.split(',').map(p => p.trim()).filter(Boolean) : undefined
    return await Git.getDiff(params.id, paths, query.repo)
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
  .get('/:id/git/merge-base', ({ params, query }) => Git.getMergeBase(params.id, query.baseBranch, query.repo), {
    detail: {
      summary: 'Get git merge base',
    },
    params: GitModel.idParams,
    query: GitModel.mergeBaseQuery,
    response: { 200: GitModel.mergeBaseView },
  })
  .get('/:id/git/branch-compare', ({ params, query }) => {
    return Git.getBranchCompare(params.id, query.baseRef, query.headRef, query.repo)
  }, {
    detail: {
      summary: 'Get git branch compare diff',
    },
    params: GitModel.idParams,
    query: GitModel.branchCompareQuery,
    response: { 200: GitModel.branchCompareView },
  })
