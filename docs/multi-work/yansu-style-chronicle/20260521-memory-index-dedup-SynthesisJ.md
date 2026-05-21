# Chronicle Memory Index And Dedup Synthesis

## Scope

This slice adds the Chronicle-owned memory keyword index and content-hash dedup foundation.

It intentionally does not implement FTS5 virtual tables, embedding inference, cosine similarity, or semantic merge policies. Those remain separate runtime slices.

## Implementation

- Added `chronicle_memories.content_hash`.
- Added `chronicle_memory_chunks`.
- Added `chronicle_memory_keywords`.
- Generated the migration through Drizzle Kit:
  - `packages/db/drizzle/0025_lowly_stature.sql`
  - `packages/db/drizzle/meta/0025_snapshot.json`
  - `packages/db/drizzle/meta/_journal.json`
- Updated `recordMemory()` to:
  - canonicalize content.
  - write content hash.
  - merge cross-source duplicate canonical content.
  - rebuild chunk and keyword rows on insert/update.
  - delete an existing source row when an update turns into a duplicate of another memory.
- Updated `/chronicle/memories/search` to:
  - reconcile legacy memory rows for the current DB path.
  - search `chronicle_memory_keywords`.
  - rank by weighted term hits and phrase containment.

## Review Findings And Fixes

Review found three blocking issues:

1. Existing upgraded DB rows without `content_hash` or keyword rows would become unsearchable.
2. Memory row writes and index rebuild were not atomic.
3. Updating an existing `sourceId` into duplicate content could leave two canonical duplicates.

Fixes applied:

1. Added `reconcileMemorySearchIndex()` keyed by current DB path. It backfills missing `content_hash`, chunks, and keywords before search/write.
2. Moved memory row mutation and index rebuild into the same Drizzle transaction.
3. Added duplicate lookup that excludes only the current row, then merges/deletes when an update collides with another canonical memory.

## Verification

Passed:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
git diff --check -- packages/db/src/schema/chronicle.ts packages/db/src/schema/README.md packages/db/drizzle/0025_lowly_stature.sql packages/db/drizzle/meta/_journal.json packages/db/drizzle/meta/0025_snapshot.json apps/server/src/modules/chronicle/service.ts apps/server/src/modules/chronicle/README.md apps/server/tests/chronicle.test.ts docs/exec-plans/20260521-03-yansu-style-chronicle.md
```

Test coverage added:

- legacy rows without index are searchable after reconciliation.
- memory update rebuilds keyword rows and stale terms no longer match.
- cross-source canonical duplicates merge.
- update-into-duplicate deletes the replaced row and its cascade-owned chunks.
- model resource lifecycle coverage from the previous slice remains passing.

## Residual Risk

- Keyword search is not FTS5 and has no stemming or language segmentation beyond Unicode tokenization.
- `embedding_status` is stored as `missing`; there is no embedding runtime yet.
- Reconciliation is path-cached per process. If future code manually mutates memory/index tables outside `recordMemory()`, it should either call a reconcile route or clear that cache.
