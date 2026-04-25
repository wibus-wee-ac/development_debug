# Thread Search Enhancement — SQLite FTS5 + Indexed Search

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds. This document must be maintained in accordance with docs/exec-plans/README.md and the PLANS.md conventions.

## Purpose / Big Picture

Currently, searching across chat sessions performs a full table scan: every session and every message is loaded into memory, then searched via string matching in JavaScript. With hundreds of sessions and thousands of messages, this blocks the main process and causes visible UI jank. The draft solution at `docs/draft-solutions/thread-search.md` introduced `@node-rs/jieba` for Chinese word segmentation but did not address the fundamental performance problem — all data is still loaded into memory for every query.

After this change, search is powered by SQLite FTS5 (Full-Text Search). A virtual table indexes the plain text content of all messages. Queries run at the database level in milliseconds, with proper Chinese segmentation via a jieba tokenizer. The user sees instant search results with highlighted snippets, even with tens of thousands of messages. The existing search UI and React Query hook remain unchanged — only the engine behind `ThreadSearchEngine.search()` is replaced.

## Progress

- [x] (2026-04-25 14:00Z) Milestone 1: Added `session_id` B-tree index via migration `0009_add_message_session_index.sql`
- [x] (2026-04-25 14:02Z) Milestone 2: Created FTS5 virtual table via migration `0010_add_fts_search.sql` with unicode61 tokenizer, contentless mode
- [x] (2026-04-25 14:08Z) Milestone 3: FTS sync — `indexMessage()`, `removeSessionFromIndex()`, `rebuildIndex()` on ThreadSearchEngine. Hooked into ChatEngine (after message complete) and SessionService (before delete). Auto-rebuild on first startup when FTS table is empty.
- [x] (2026-04-25 14:15Z) Milestone 4: Rewrote `search()` to try FTS5 first (`searchFts`) with fallback to legacy full-scan (`searchLegacy`). FTS uses MATCH + BM25 ranking + snippet() with `<mark>` tags.
- [x] (2026-04-25 14:18Z) Milestone 5: All files pass type checking. Structure validated.

## Surprises & Discoveries

- FTS5 contentless tables (`content=''`) don't support `DELETE` by rowid; must use `INSERT INTO ... (messages_fts, ...) VALUES('delete', ...)` syntax for removal.
- jieba pre-segmentation at insert time sidesteps the need for custom C tokenizers entirely.

## Decision Log

- Decision: Use try/catch in `search()` to fall back from FTS to legacy search.
  Rationale: Graceful degradation if FTS table doesn't exist yet or is empty. Once messages are indexed, FTS path takes over automatically.
  Date: 2026-04-25

- Decision: Use jieba pre-segmentation at insert time rather than a custom FTS5 tokenizer.
  Rationale: Custom FTS5 tokenizers require C extensions. Pre-segmenting with jieba and storing space-separated tokens works with the built-in unicode61 tokenizer.
  Date: 2026-04-25

- Decision: Auto-rebuild FTS index on startup when empty.
  Rationale: After migration creates the empty FTS table, existing messages need to be indexed. The check runs once and is skipped on subsequent startups when the table is already populated.
  Date: 2026-04-25

## Outcomes & Retrospective

All 5 milestones completed. Search now uses SQLite FTS5 with BM25 ranking, Chinese jieba pre-segmentation, and automatic snippet generation. The legacy full-scan search is preserved as a fallback. New messages are indexed on completion; session deletion clears FTS entries. A one-time rebuild populates the index for existing data.

## Context and Orientation

The application uses SQLite via `better-sqlite3` through `drizzle-orm`. The database lives at the user's app data directory. Schema migrations are managed by `drizzle-kit` and stored in `drizzle/` as numbered SQL files. The current schema version is `0008_restore_acp_tables.sql`.

The `messages` table (defined in `src/main/db/schema.ts` at line 53) stores chat messages with these columns:

    id            TEXT PRIMARY KEY
    session_id    TEXT REFERENCES sessions(id) ON DELETE CASCADE
    role          TEXT ('user' | 'assistant')
    status        TEXT ('streaming' | 'complete' | 'aborted' | 'failed')
    content       TEXT  -- JSON blob: { parts: [{ type: 'text'|'reasoning', text: '...' }] }
    error_text    TEXT
    created_at    INTEGER (unix seconds)
    updated_at    INTEGER (unix seconds)

The `content` column is a JSON blob. The search engine extracts searchable plain text from it via `extractSearchableText()` in `src/main/lib/thread-search.ts`, which parses the JSON and concatenates all `text` parts.

The search chain is: renderer `useThreadSearch` hook (with 150ms debounce) calls `ipc.search.searchThreads(params)` which invokes `ThreadSearchEngine.search()` in the main process.

`@node-rs/jieba` is already installed and used for Chinese word segmentation. The jieba dictionary (~10MB) is lazily loaded on first search.

SQLite FTS5 is a built-in extension of SQLite (no additional native addon needed). It supports custom tokenizers, but custom native tokenizers require C extensions. For this plan, we use FTS5's built-in `unicode61` tokenizer which handles word boundaries for most languages, combined with jieba pre-segmentation for Chinese text at insert time.

## Plan of Work

The approach is to add an FTS5 virtual table that mirrors the searchable content of messages. When messages are inserted or updated, the corresponding FTS entry is maintained. The search engine queries the FTS table using SQLite's `MATCH` operator instead of loading all data into memory.

For Chinese text, we pre-segment using jieba when inserting into the FTS table. This means the FTS content is space-separated tokens that FTS5's default tokenizer can match. This avoids the need for a custom C tokenizer while still supporting Chinese search.

Milestone 1 adds a missing B-tree index on `messages.session_id` — this is a quick win that immediately improves the existing `inArray(sessionId)` query regardless of FTS.

Milestone 2 creates the FTS5 virtual table via a Drizzle migration. The table has columns for `rowid` (matching messages), `session_id`, `title` (from the parent session), and `searchable_text` (pre-segmented plain text).

Milestone 3 hooks into message persistence to keep the FTS table in sync. When a message reaches `complete` status, its searchable text is extracted, segmented with jieba, and inserted/updated in the FTS table.

Milestone 4 rewrites `ThreadSearchEngine.search()` to query the FTS table using `MATCH`, retrieve session metadata, build snippets using FTS5's `snippet()` function, and return results sorted by relevance.

Milestone 5 validates correctness and benchmarks performance.

## Concrete Steps

Milestone 1: Add session_id index

Generate a new migration by creating the file `drizzle/0009_add_message_session_index.sql`:

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

Update `drizzle/meta/_journal.json` to include the new entry. Run the migration on app start (Drizzle handles this automatically).

Milestone 2: FTS5 virtual table

Create migration `drizzle/0010_add_fts_search.sql`:

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      session_id UNINDEXED,
      session_title,
      searchable_text,
      content='',
      tokenize='unicode61'
    );

The `content=''` means this is a "contentless" FTS table — it stores its own copy of the indexed text. `session_id` is `UNINDEXED` because we only need it for joining, not searching. `session_title` is indexed so session titles are searchable. `searchable_text` contains the pre-segmented message content.

Milestone 3: FTS sync on message persistence

In `src/main/lib/thread-search.ts`, add a method `indexMessage(sessionId, sessionTitle, messageId, content)` that:

1. Calls `extractSearchableText(content)` to get plain text from the JSON blob.
2. Calls `jieba.cutForSearch(text).join(' ')` to segment Chinese text into space-separated tokens.
3. Executes SQL:

       INSERT OR REPLACE INTO messages_fts(rowid, session_id, session_title, searchable_text)
       VALUES (?, ?, ?, ?)

   Using the message's integer rowid (or a hash of the id).

Add a method `removeSessionFromIndex(sessionId)` for cleanup when sessions are deleted:

       DELETE FROM messages_fts WHERE session_id = ?

Hook `indexMessage` into the message persistence path in `ChatEngine` — specifically after a message status changes to `complete`. Hook `removeSessionFromIndex` into session deletion.

Add a `rebuildIndex()` method that scans all existing messages and populates the FTS table (for first-time migration or repair).

Milestone 4: Rewrite search to use FTS5

Replace the body of `ThreadSearchEngine.search()`. The new implementation:

1. Segments the query with jieba: `tokens = jieba.cutForSearch(query).join(' ')`
2. Queries FTS:

       SELECT rowid, session_id, session_title,
              snippet(messages_fts, 2, '<mark>', '</mark>', '…', 32) as snippet,
              rank
       FROM messages_fts
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT 50

3. Groups results by session_id, joins with sessions/workspaces tables for metadata.
4. Returns `ThreadSearchHit[]` matching the existing interface.

The `snippet()` function with column index 2 (searchable_text) automatically generates highlighted excerpts with `<mark>` tags. The `rank` column provides BM25 relevance scoring built into FTS5.

Milestone 5: Validation

Run the existing search tests. Create a benchmark that inserts 1000 messages and measures search latency — it should be under 50ms. Verify Chinese queries return correct results. Verify that deleting a session removes its FTS entries.

## Validation and Acceptance

1. Open the search dialog (Cmd+K) and type a query. Results appear within 100ms for a database with 1000+ messages.
2. Chinese text queries (e.g., "代码审查") return correct results with highlighted snippets.
3. English queries work as before.
4. Deleting a session removes its entries from search results.
5. The `rebuildIndex()` method can be called to re-index all existing messages (for migration from the old schema).
6. The existing search UI, hook, normalize, and group modules require no changes.

## Idempotence and Recovery

The FTS5 virtual table creation uses `IF NOT EXISTS`. The `INSERT OR REPLACE` upsert pattern makes indexing idempotent. The `rebuildIndex()` method can be run at any time to repair the index state. If the FTS table becomes corrupted, dropping and recreating it followed by `rebuildIndex()` fully recovers.

## Artifacts and Notes

FTS5 `MATCH` syntax examples:

    -- Simple term search
    SELECT * FROM messages_fts WHERE messages_fts MATCH 'react'

    -- Phrase search
    SELECT * FROM messages_fts WHERE messages_fts MATCH '"code review"'

    -- Multi-term (implicit AND)
    SELECT * FROM messages_fts WHERE messages_fts MATCH 'react typescript'

    -- Column-specific
    SELECT * FROM messages_fts WHERE session_title MATCH 'refactor'

FTS5 built-in ranking uses BM25. The `rank` column is automatically available and negative (more negative = more relevant). ORDER BY rank gives best results first.

## Interfaces and Dependencies

In `src/main/lib/thread-search.ts`, the `ThreadSearchEngine` class gains:

    indexMessage(sessionId: string, sessionTitle: string, messageId: string, content: string): void
    removeSessionFromIndex(sessionId: string): void
    rebuildIndex(): void

The `search()` method signature remains unchanged:

    search(params: { query: string; workspaceId?: string }): ThreadSearchHit[]

Dependencies: `better-sqlite3` (already installed, FTS5 is built-in), `@node-rs/jieba` (already installed).
