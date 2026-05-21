# Chronicle Knowledge Crystallization Synthesis AX

## Scope

Implemented the Chronicle-owned knowledge crystallization and dream merge dry-run foundation after ReviewAW.

## Changes

- Added Drizzle schema-first knowledge and dream persistence:
  - `chronicle_knowledge_cards`
  - `chronicle_knowledge_versions`
  - `chronicle_knowledge_files`
  - `chronicle_knowledge_sources`
  - `chronicle_dream_runs`
  - `chronicle_dream_candidates`
- Generated Drizzle migrations:
  - `0031_shallow_captain_midlands`
  - `0032_powerful_talos`
  - `0033_next_vector`
- Added Server routes:
  - `POST /chronicle/activity-segments/:segmentId/crystallize`
  - `GET /chronicle/knowledge-cards`
  - `GET /chronicle/knowledge-cards/:knowledgeId/versions`
  - `GET /chronicle/dream-runs`
  - `POST /chronicle/dream-runs`
- Added service behavior:
  - model-backed crystallization with bounded JSON parsing
  - stable knowledge identity through `stableKey`
  - knowledge card versioning
  - normalized knowledge source links
  - pipeline idempotency by segment/stage/evidence hash
  - dream merge dry-run candidate recording using `chronicle-lexical/v1`
- Added Web UI:
  - Crystallize button on activity segment cards
  - Knowledge Cards section
  - Dream Merge Dry Run section
- Extended Chronicle tests for crystallization, idempotency, versions, source links, knowledge list, dream dry-run, and status counts.

## Validation

- `pnpm exec drizzle-kit generate --config drizzle.config.ts`
- `pnpm --filter @cradle/server exec tsc --noEmit`
- `pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts`
- `pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx`

## Remaining Scope

This does not claim full Yansu parity. Automatic pipeline scheduling, AXObserver notification lifecycle, system audio capture, real VAD/ASR/speaker runtimes, ONNX text embeddings, semantic merge thresholds, and solve-layer integration remain open.
