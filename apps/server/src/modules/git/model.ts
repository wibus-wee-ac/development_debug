import { t } from 'elysia'

export const GitModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  graphQuery: t.Object({
    limit: t.Optional(t.Numeric({ minimum: 1 })),
  }),

  checkoutBody: t.Object({
    branch: t.String({ minLength: 1 }),
  }),

  createBranchBody: t.Object({
    name: t.String({ minLength: 1 }),
    from: t.Optional(t.String({ minLength: 1 })),
  }),

  statusView: t.Object({
    branch: t.String(),
    tracking: t.Nullable(t.String()),
    ahead: t.Number(),
    behind: t.Number(),
    isDetached: t.Boolean(),
    files: t.Array(t.Object({
      path: t.String(),
      status: t.Union([
        t.Literal('added'),
        t.Literal('modified'),
        t.Literal('deleted'),
        t.Literal('renamed'),
        t.Literal('untracked'),
      ]),
    })),
  }),

  branchesView: t.Object({
    local: t.Array(t.Object({
      name: t.String(),
      isCurrent: t.Boolean(),
      tracking: t.Optional(t.String()),
    })),
    remote: t.Array(t.Object({
      name: t.String(),
    })),
  }),

  remotesView: t.Array(t.Object({
    name: t.String(),
    fetchUrl: t.Nullable(t.String()),
    pushUrl: t.Nullable(t.String()),
  })),

  graphCommitView: t.Object({
    sha: t.String(),
    shortSha: t.String(),
    parents: t.Array(t.String()),
    refs: t.Array(t.String()),
    subject: t.String(),
    authorName: t.String(),
    authorEmail: t.String(),
    gravatarHash: t.String(),
    date: t.String(),
    timestamp: t.Number(),
  }),
}
