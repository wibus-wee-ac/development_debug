# Chronicle Semantic Retrieval Foundation Synthesis

## Scope

This slice adds a Chronicle-owned semantic retrieval foundation.

It does not complete ONNX embedding inference, background embedding workers, FTS5, or semantic duplicate merge policies.

## Implementation

- Added `chronicle_memory_embeddings` in `packages/db/src/schema/chronicle.ts`.
- Generated Drizzle migration artifacts:
  - `packages/db/drizzle/0026_perfect_korath.sql`
  - `packages/db/drizzle/meta/0026_snapshot.json`
  - `packages/db/drizzle/meta/_journal.json`
- Updated Server memory indexing to write:
  - `chronicle_memory_chunks`
  - `chronicle_memory_keywords`
  - `chronicle_memory_embeddings`
- Added `chronicle-lexical/v1` deterministic local vectors as a replaceable vector generator.
- Updated `/chronicle/memories/search` to merge:
  - phrase containment boost
  - keyword score
  - semantic cosine score
- Updated memory response shape with nullable:
  - `matchKind`
  - `keywordScore`
  - `semanticScore`
- Updated Web Settings memory cards to show Keyword, Semantic, or Hybrid match badges.

## Review Constraints Applied

- No hand-written orphan SQL.
- No writes outside Chronicle namespace.
- No claim that ONNX embedding runtime is complete.
- No semantic duplicate merge by default.
- Keyword-only fallback remains available.
- Semantic-only matches can surface because search no longer returns early when keyword rows are absent.

## Verification

Passed:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

The Chronicle server test covers embedding row creation, chunk `embeddingStatus = missing` for future neural embedding runtime, keyword fallback, semantic-only search, stale keyword cleanup, duplicate merge, update-into-duplicate cleanup, Slack memory search, and local model resource lifecycle.

## Residual Risk

- Vector scan is linear over ready embedding rows. This is acceptable for the current Settings path but should become candidate-limited or indexed before large-scale histories.
- `chronicle-lexical/v1` is deterministic lexical similarity, not neural semantic embedding.
- Installing the local embedding model resource does not yet start ONNX inference.
