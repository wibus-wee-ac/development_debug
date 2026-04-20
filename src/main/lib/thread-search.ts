// Input: @node-rs/jieba (lazy-init with default dict), drizzle-orm DB, UIMessage JSON decoder
// Output: ThreadSearchEngine singleton — jieba-tokenized title+content search across sessions/messages
// Position: Main-process core library (L2) used by SearchService IPC layer

import { desc, eq, inArray } from 'drizzle-orm'

import { getDb } from '../db'
import { messages, sessions, workspaces } from '../db/schema'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchRange {
  start: number
  end: number
}

export interface ThreadSearchSnippet {
  text: string
  ranges: MatchRange[]
  messageRole: 'user' | 'assistant'
  messageId: string
  /** unix seconds — snippets within a session sort newest-first */
  createdAt: number
}

export interface ThreadSearchHit {
  sessionId: string
  workspaceId: string
  workspaceName: string | null
  sessionTitle: string
  titleRanges: MatchRange[]
  /** Matching snippets for this session — includes user AND assistant turns. */
  snippets: ThreadSearchSnippet[]
  matchCount: number
  score: number
  updatedAt: number
}

export interface ThreadSearchParams {
  query: string
  /** Scope to a single workspace. Omit for global search. */
  workspaceId?: string
  /** Maximum results to return. Defaults to 50. */
  limit?: number
  /** Max snippets per session hit. Defaults to 3. */
  snippetsPerHit?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50
const DEFAULT_SNIPPETS_PER_HIT = 3
const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 120
const ELLIPSIS = '…'
const TITLE_WEIGHT = 10
const CONTENT_WEIGHT = 1

// ── Engine ────────────────────────────────────────────────────────────────────

export class ThreadSearchEngine {
  private static instance: ThreadSearchEngine
  // eslint-disable-next-line ts/no-explicit-any
  private jieba: any = null

  static getInstance(): ThreadSearchEngine {
    if (!ThreadSearchEngine.instance) {
      ThreadSearchEngine.instance = new ThreadSearchEngine()
    }
    return ThreadSearchEngine.instance
  }

  /**
   * Tokenize a search query via jieba (lazy-loaded). Returns the deduplicated
   * union of the raw query plus jieba-cut segments, with whitespace/empty
   * tokens dropped. The raw query is included so exact multi-word phrases
   * still match verbatim.
   */
  tokenize(query: string): string[] {
    const trimmed = query.trim()
    if (!trimmed) {
      return []
    }

    const jieba = this.getJieba()
    const segments = jieba ? jieba.cutForSearch(trimmed, true) : [trimmed]
    const seen = new Set<string>()
    const tokens: string[] = []
    for (const token of [trimmed, ...segments]) {
      const clean = typeof token === 'string' ? token.trim() : ''
      if (!clean) {
        continue
      }
      const key = clean.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      tokens.push(clean)
    }
    return tokens
  }

  /**
   * Search sessions + their messages for the given query. Returns one hit per
   * matching session, ranked by score (title matches weigh 10×, content 1×)
   * then by recency.
   */
  search(params: ThreadSearchParams): ThreadSearchHit[] {
    const tokens = this.tokenize(params.query)
    if (tokens.length === 0) {
      return []
    }

    const limit = params.limit ?? DEFAULT_LIMIT
    const snippetsPerHit = params.snippetsPerHit ?? DEFAULT_SNIPPETS_PER_HIT
    const db = getDb()

    const sessionRows = params.workspaceId
      ? db
          .select()
          .from(sessions)
          .where(eq(sessions.workspaceId, params.workspaceId))
          .orderBy(desc(sessions.updatedAt))
          .all()
      : db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all()

    if (sessionRows.length === 0) {
      return []
    }

    const workspaceIds = [...new Set(sessionRows.map(s => s.workspaceId))]
    const workspaceRows = db
      .select()
      .from(workspaces)
      .where(inArray(workspaces.id, workspaceIds))
      .all()
    const workspaceNameById = new Map(workspaceRows.map(w => [w.id, w.name]))

    const sessionIds = sessionRows.map(s => s.id)
    const messageRows = db
      .select()
      .from(messages)
      .where(inArray(messages.sessionId, sessionIds))
      .all()

    const messagesBySession = new Map<string, typeof messageRows>()
    for (const row of messageRows) {
      const list = messagesBySession.get(row.sessionId) ?? []
      list.push(row)
      messagesBySession.set(row.sessionId, list)
    }

    const hits: ThreadSearchHit[] = []
    for (const session of sessionRows) {
      const titleRanges = findMatches(session.title, tokens)
      const msgs = messagesBySession.get(session.id) ?? []

      const candidateSnippets: Array<
        ThreadSearchSnippet & { matchCount: number }
      > = []
      let contentMatchCount = 0

      for (const msg of msgs) {
        if (msg.role !== 'user' && msg.role !== 'assistant') {
          continue
        }
        const text = extractSearchableText(msg.content)
        if (!text) {
          continue
        }
        const ranges = findMatches(text, tokens)
        if (ranges.length === 0) {
          continue
        }
        contentMatchCount += ranges.length
        const snippet = extractSnippet(text, ranges)
        candidateSnippets.push({
          text: snippet.text,
          ranges: snippet.ranges,
          messageRole: msg.role,
          messageId: msg.id,
          createdAt: msg.createdAt,
          matchCount: ranges.length,
        })
      }

      const matchCount = titleRanges.length + contentMatchCount
      if (matchCount === 0) {
        continue
      }

      // Keep strongest matches first (match density, then recency). Take both
      // user and assistant turns equally — users explicitly asked for assistant
      // answers to surface alongside their own questions.
      candidateSnippets.sort((a, b) => {
        if (b.matchCount !== a.matchCount) {
          return b.matchCount - a.matchCount
        }
        return b.createdAt - a.createdAt
      })

      const snippets: ThreadSearchSnippet[] = candidateSnippets
        .slice(0, snippetsPerHit)
        .map(({ matchCount: _ignored, ...rest }) => rest)

      const score = titleRanges.length * TITLE_WEIGHT + contentMatchCount * CONTENT_WEIGHT

      hits.push({
        sessionId: session.id,
        workspaceId: session.workspaceId,
        workspaceName: workspaceNameById.get(session.workspaceId) ?? null,
        sessionTitle: session.title,
        titleRanges,
        snippets,
        matchCount,
        score,
        updatedAt: session.updatedAt,
      })
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return b.updatedAt - a.updatedAt
    })

    return hits.slice(0, limit)
  }

  // eslint-disable-next-line ts/no-explicit-any
  private getJieba(): any {
    if (this.jieba) {
      return this.jieba
    }
    try {
      // Lazy-require so renderer typechecks don't drag in the native module
      // and so startup cost (≈10 MB dict) is paid on first query, not boot.
      // eslint-disable-next-line ts/no-require-imports
      const { Jieba } = require('@node-rs/jieba') as typeof import('@node-rs/jieba')
      // eslint-disable-next-line ts/no-require-imports
      const { dict } = require('@node-rs/jieba/dict') as typeof import('@node-rs/jieba/dict')
      this.jieba = Jieba.withDict(dict)
    }
    catch (err) {
      console.error('[ThreadSearchEngine] Failed to init jieba, falling back to whitespace split:', err)
      this.jieba = null
    }
    return this.jieba
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find every case-insensitive occurrence of each token in `text`, returning
 * non-overlapping merged ranges in ascending order.
 */
function findMatches(text: string, tokens: string[]): MatchRange[] {
  if (!text) {
    return []
  }
  const lowerText = text.toLowerCase()
  const raw: MatchRange[] = []
  for (const token of tokens) {
    if (!token) {
      continue
    }
    const lower = token.toLowerCase()
    let cursor = 0
    while (true) {
      const pos = lowerText.indexOf(lower, cursor)
      if (pos === -1) {
        break
      }
      raw.push({ start: pos, end: pos + token.length })
      cursor = pos + Math.max(token.length, 1)
    }
  }
  if (raw.length === 0) {
    return []
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MatchRange[] = []
  for (const r of raw) {
    const last = merged.at(-1)
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    }
    else {
      merged.push({ start: r.start, end: r.end })
    }
  }
  return merged
}

/**
 * Build a preview window around the first match, with ranges re-indexed
 * relative to the snippet's coordinate system (including the leading
 * ellipsis offset, if one was added).
 */
function extractSnippet(
  text: string,
  ranges: MatchRange[],
): { text: string, ranges: MatchRange[] } {
  if (ranges.length === 0) {
    const truncated = text.length > SNIPPET_BEFORE + SNIPPET_AFTER
      ? `${text.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER)}${ELLIPSIS}`
      : text
    return { text: truncated, ranges: [] }
  }

  const first = ranges[0]
  const rawStart = Math.max(0, first.start - SNIPPET_BEFORE)
  const rawEnd = Math.min(text.length, first.start + SNIPPET_AFTER)
  const leading = rawStart > 0 ? ELLIPSIS : ''
  const trailing = rawEnd < text.length ? ELLIPSIS : ''
  const snippetText = `${leading}${text.slice(rawStart, rawEnd)}${trailing}`
  const offset = leading.length

  const shifted: MatchRange[] = []
  for (const r of ranges) {
    if (r.end <= rawStart || r.start >= rawEnd) {
      continue
    }
    const start = Math.max(r.start, rawStart) - rawStart + offset
    const end = Math.min(r.end, rawEnd) - rawStart + offset
    if (end > start) {
      shifted.push({ start, end })
    }
  }
  return { text: snippetText, ranges: shifted }
}

/**
 * Pull searchable plain text out of a UIMessage-encoded `messages.content`
 * blob — concatenating every `text` and `reasoning` part. Falls back to the
 * raw string when the JSON shape isn't recognised.
 */
function extractSearchableText(content: string): string {
  if (!content) {
    return ''
  }
  try {
    const parsed = JSON.parse(content) as { parts?: unknown }
    if (!Array.isArray(parsed.parts)) {
      return typeof content === 'string' ? content : ''
    }
    const out: string[] = []
    for (const part of parsed.parts) {
      if (!part || typeof part !== 'object') {
        continue
      }
      const p = part as { type?: unknown, text?: unknown }
      if ((p.type === 'text' || p.type === 'reasoning') && typeof p.text === 'string') {
        out.push(p.text)
      }
    }
    return out.join('\n')
  }
  catch {
    return content
  }
}
