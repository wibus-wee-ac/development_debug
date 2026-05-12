// Input: ThreadSearchHit and MatchRange types from @main/ipc-types
// Output: Normalizers that coerce IPC search payloads into UI-safe thread search hits
// Position: Search feature boundary utility between IPC responses and renderer components

import type { MatchRange, ThreadSearchHit, ThreadSearchSnippet } from '~/lib/types'

const FALLBACK_WORKSPACE_ID = 'unknown-workspace'
const FALLBACK_SESSION_ID = 'unknown-session'
const FTS_MARK_TAG_RE = /<\/?mark>/g

type PartialThreadSearchSnippet = Partial<ThreadSearchSnippet>

export interface ThreadSearchHitPayload extends Omit<Partial<ThreadSearchHit>, 'snippets'> {
  snippets?: Array<PartialThreadSearchSnippet | undefined>
}

function normalizeRanges(ranges: MatchRange[] | undefined): MatchRange[] {
  return Array.isArray(ranges) ? ranges : []
}

function normalizeSnippet(
  snippet: Partial<ThreadSearchSnippet> | undefined,
  index: number,
): ThreadSearchSnippet {
  const ranges = normalizeRanges(snippet?.ranges)
  const rawText = typeof snippet?.text === 'string' ? snippet.text : ''

  return {
    text: ranges.length > 0 ? rawText.replace(FTS_MARK_TAG_RE, '') : rawText,
    ranges,
    messageRole: snippet?.messageRole === 'assistant' ? 'assistant' : 'user',
    messageId:
      typeof snippet?.messageId === 'string' && snippet.messageId.length > 0
        ? snippet.messageId
        : `missing-message-${index}`,
    createdAt: typeof snippet?.createdAt === 'number' ? snippet.createdAt : 0,
  }
}

export function normalizeThreadSearchHit(hit: ThreadSearchHitPayload): ThreadSearchHit {
  const snippets = Array.isArray(hit.snippets)
    ? hit.snippets.map((snippet, index) => normalizeSnippet(snippet, index))
    : []

  return {
    sessionId:
      typeof hit.sessionId === 'string' && hit.sessionId.length > 0
        ? hit.sessionId
        : FALLBACK_SESSION_ID,
    workspaceId:
      typeof hit.workspaceId === 'string' && hit.workspaceId.length > 0
        ? hit.workspaceId
        : FALLBACK_WORKSPACE_ID,
    workspaceName: typeof hit.workspaceName === 'string' ? hit.workspaceName : null,
    sessionTitle: typeof hit.sessionTitle === 'string' ? hit.sessionTitle : '',
    titleRanges: normalizeRanges(hit.titleRanges),
    snippets,
    matchCount: typeof hit.matchCount === 'number' ? hit.matchCount : snippets.length,
    score: typeof hit.score === 'number' ? hit.score : 0,
    updatedAt: typeof hit.updatedAt === 'number' ? hit.updatedAt : 0,
  }
}

export function normalizeThreadSearchHits(hits: ThreadSearchHitPayload[] | undefined): ThreadSearchHit[] {
  if (!Array.isArray(hits)) {
    return []
  }

  return hits.map(normalizeThreadSearchHit)
}
