// Input: @node-rs/jieba (lazy-init with default dict), drizzle-orm DB, and timeline-derived assistant text helper
// Output: ThreadSearchEngine singleton — jieba-tokenized title+content search across sessions/messages
// Position: Chat/search capability module (L2) used by the SearchService IPC layer

import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import { desc, eq, inArray, sql } from 'drizzle-orm'

import { getDb } from '../db'
import { messages, sessions, workspaces } from '../db/schema'
import { extractAssistantTextByMessageId } from './timeline-query'

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
  private jieba: Jieba | null = null

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
   * Search sessions + their messages for the given query using FTS5.
   * Falls back to legacy full-scan search if FTS table is empty or fails.
   */
  search(params: ThreadSearchParams): ThreadSearchHit[] {
    try {
      return this.searchFts(params)
    }
    catch {
      // FTS table may not exist yet or be empty — fall back to legacy
      return this.searchLegacy(params)
    }
  }

  /**
   * FTS5-powered search. Uses SQLite MATCH + BM25 ranking.
   */
  private searchFts(params: ThreadSearchParams): ThreadSearchHit[] {
    const tokens = this.tokenize(params.query)
    if (tokens.length === 0) {
      return []
    }

    const limit = params.limit ?? DEFAULT_LIMIT
    const snippetsPerHit = params.snippetsPerHit ?? DEFAULT_SNIPPETS_PER_HIT
    const db = getDb()

    // Segment query for FTS matching
    const jieba = this.getJieba()
    const ftsQuery = jieba
      ? (jieba.cutForSearch(params.query.trim(), true) as string[])
          .filter((t: string) => t.trim())
          .join(' ')
      : params.query.trim()

    if (!ftsQuery) {
      return []
    }

    // Query FTS5 table
    const ftsRows = db.all<{
      rowid: number
      session_id: string
      session_title: string
      snippet: string
      rank: number
    }>(
      sql`SELECT rowid, session_id, session_title,
                 snippet(messages_fts, 2, '<mark>', '</mark>', '…', 48) as snippet,
                 rank
          FROM messages_fts
          WHERE messages_fts MATCH ${ftsQuery}
          ORDER BY rank
          LIMIT ${limit * 3}`,
    )

    if (ftsRows.length === 0) {
      // FTS empty — fall back to legacy
      return this.searchLegacy(params)
    }

    // Group by session
    const sessionMap = new Map<string, {
      sessionTitle: string
      snippets: Array<{ text: string, rank: number, rowid: number }>
      bestRank: number
    }>()

    for (const row of ftsRows) {
      if (params.workspaceId) {
        // Need to filter by workspace — check session
        const session = db.select().from(sessions).where(eq(sessions.id, row.session_id)).get()
        if (!session || session.workspaceId !== params.workspaceId) {
          continue
        }
      }

      let entry = sessionMap.get(row.session_id)
      if (!entry) {
        entry = { sessionTitle: row.session_title, snippets: [], bestRank: row.rank }
        sessionMap.set(row.session_id, entry)
      }
      entry.snippets.push({ text: row.snippet, rank: row.rank, rowid: row.rowid })
      if (row.rank < entry.bestRank) {
        entry.bestRank = row.rank
      }
    }

    // Build hits
    const sessionIds = [...sessionMap.keys()]
    const sessionRows = db.select().from(sessions).where(inArray(sessions.id, sessionIds)).all()
    const sessionById = new Map(sessionRows.map(s => [s.id, s]))

    const workspaceIds = [...new Set(sessionRows.map(s => s.workspaceId))]
    const workspaceRows = db.select().from(workspaces).where(inArray(workspaces.id, workspaceIds)).all()
    const workspaceNameById = new Map(workspaceRows.map(w => [w.id, w.name]))

    const hits: ThreadSearchHit[] = []
    for (const [sessionId, entry] of sessionMap) {
      const session = sessionById.get(sessionId)
      if (!session) {
        continue
      }

      const titleRanges = findMatches(session.title, tokens)
      const snippets: ThreadSearchSnippet[] = entry.snippets
        .slice(0, snippetsPerHit)
        .map(s => ({
          text: s.text,
          ranges: extractMarkRanges(s.text),
          messageRole: 'assistant' as const,
          messageId: String(s.rowid),
          createdAt: session.updatedAt,
        }))

      hits.push({
        sessionId,
        workspaceId: session.workspaceId,
        workspaceName: workspaceNameById.get(session.workspaceId) ?? null,
        sessionTitle: session.title,
        titleRanges,
        snippets,
        matchCount: titleRanges.length + entry.snippets.length,
        score: Math.abs(entry.bestRank) * 100 + titleRanges.length * TITLE_WEIGHT,
        updatedAt: session.updatedAt,
      })
    }

    hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
    return hits.slice(0, limit)
  }

  /**
   * Legacy full-scan search. Used as fallback when FTS table is empty.
   */
  private searchLegacy(params: ThreadSearchParams): ThreadSearchHit[] {
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
        const text = msg.role === 'assistant'
          ? extractAssistantTextByMessageId(db, msg.id)
          : msg.content
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

  private getJieba(): Jieba | null {
    if (this.jieba) {
      return this.jieba
    }
    try {
      // Keep instance creation lazy so startup cost (≈10 MB dict) is only paid
      // on first query/index operation, not during app boot.
      this.jieba = Jieba.withDict(dict)
    }
    catch (err) {
      console.error('[ThreadSearchEngine] Failed to init jieba, falling back to whitespace split:', err)
      this.jieba = null
    }
    return this.jieba
  }

  /* ── FTS5 index management ─────────────────────────────── */

  /**
   * Index or re-index a single message in the FTS5 table.
   * Should be called after a message reaches `complete` status.
   */
  indexMessage(sessionId: string, sessionTitle: string, messageId: string, content: string): void {
    if (!this.hasFtsTable()) {
      return
    }

    const indexedValues = this.buildIndexedValues(sessionTitle, content)
    if (!indexedValues) {
      return
    }

    const db = getDb()
    // Use messageId hash as rowid for upsert. FTS5 contentless tables
    // require explicit rowid management.
    const rowid = this.hashId(messageId)
    db.run(sql`INSERT OR REPLACE INTO messages_fts(rowid, session_id, session_title, searchable_text)
      VALUES (${rowid}, ${sessionId}, ${indexedValues.segmentedTitle}, ${indexedValues.segmentedText})`)
  }

  /**
   * Remove all FTS entries for a session.
   */
  removeSessionFromIndex(sessionId: string): void {
    if (!this.hasFtsTable()) {
      return
    }

    const db = getDb()
    const rows = db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()

    for (const row of rows) {
      const rowid = this.hashId(row.id)
      db.run(sql`DELETE FROM messages_fts WHERE rowid = ${rowid}`)
    }
  }

  /**
   * Rebuild the entire FTS index from the messages table.
   * Useful after migration or for repair.
   */
  rebuildIndex(): void {
    if (!this.hasFtsTable()) {
      return
    }

    const db = getDb()
    // Clear existing FTS data
    db.run(sql`DELETE FROM messages_fts`)

    const sessionRows = db.select().from(sessions).all()
    const sessionTitleById = new Map(sessionRows.map(s => [s.id, s.title]))

    const messageRows = db
      .select()
      .from(messages)
      .where(eq(messages.status, 'complete'))
      .all()

    for (const msg of messageRows) {
      const title = sessionTitleById.get(msg.sessionId) ?? ''
      const content = msg.role === 'assistant'
        ? extractAssistantTextByMessageId(db, msg.id)
        : msg.content
      this.indexMessage(msg.sessionId, title, msg.id, content)
    }
  }

  /** Simple string hash → positive integer for FTS5 rowid */
  private hashId(id: string): number {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
    }
    return Math.abs(hash)
  }

  private hasFtsTable(): boolean {
    const db = getDb()
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages_fts' LIMIT 1`,
    )
    return rows.length > 0
  }

  private buildIndexedValues(sessionTitle: string, content: string): {
    segmentedTitle: string
    segmentedText: string
  } | null {
    if (!content.trim()) {
      return null
    }

    const jieba = this.getJieba()
    const segmentedText = jieba
      ? (jieba.cutForSearch(content, true) as string[]).join(' ')
      : content
    const segmentedTitle = jieba
      ? (jieba.cutForSearch(sessionTitle, true) as string[]).join(' ')
      : sessionTitle

    return { segmentedTitle, segmentedText }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract match ranges from FTS5 snippet() output that uses <mark>...</mark> tags.
 * Returns ranges relative to the text with tags stripped.
 */
function extractMarkRanges(html: string): MatchRange[] {
  const ranges: MatchRange[] = []
  let plainIdx = 0
  let i = 0
  while (i < html.length) {
    if (html.startsWith('<mark>', i)) {
      i += 6
      const start = plainIdx
      while (i < html.length && !html.startsWith('</mark>', i)) {
        plainIdx++
        i++
      }
      ranges.push({ start, end: plainIdx })
      if (html.startsWith('</mark>', i)) {
        i += 7
      }
    }
    else {
      plainIdx++
      i++
    }
  }
  return ranges
}

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

// ── Module-level singleton ────────────────────────────────────────────────────

export const threadSearchEngine = new ThreadSearchEngine()
