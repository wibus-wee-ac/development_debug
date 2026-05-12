import { t } from 'elysia'

const matchRange = t.Object({
  start: t.Number(),
  end: t.Number(),
})

const threadSearchSnippet = t.Object({
  text: t.String(),
  ranges: t.Array(matchRange),
  messageRole: t.Union([t.Literal('user'), t.Literal('assistant')]),
  messageId: t.String(),
  createdAt: t.Number(),
})

const threadSearchHit = t.Object({
  sessionId: t.String(),
  workspaceId: t.String(),
  workspaceName: t.Nullable(t.String()),
  sessionTitle: t.Nullable(t.String()),
  titleRanges: t.Array(matchRange),
  snippets: t.Array(threadSearchSnippet),
  matchCount: t.Number(),
  score: t.Number(),
  updatedAt: t.Number(),
})

export const SearchModel = {
  threadSearchResponse: t.Array(threadSearchHit),

  searchQuery: t.Object({
    query: t.String({ minLength: 1 }),
    workspaceId: t.Optional(t.String()),
    limit: t.Optional(t.Numeric({ minimum: 1 })),
    snippetsPerHit: t.Optional(t.Numeric({ minimum: 1 })),
  }),
}
