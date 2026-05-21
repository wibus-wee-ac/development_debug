# Activity Pipeline Foundation Fix

## Fixed

- Added `chronicle_pipeline_runs.source_key` with a unique index in Drizzle schema.
- Regenerated the activity pipeline migration through Drizzle Kit as `0030_dazzling_blackheart.sql`.
- Changed pipeline run status default from `success` to `queued`.
- Changed current segmentation run rows to `status: running` and added metadata naming pending downstream stages.
- Added `recordSegmentationRun()` so repeated evidence reports update the existing run by `sourceKey` instead of inserting duplicate rows.
- Tightened segment append logic so older evidence cannot merge into a later segment.
- Added tests for direct memory update idempotency and out-of-order same-title snapshot segmentation.
- Updated Web display and documentation to avoid claiming full triage/summarization/crystallization completion.

## Validation

Passed after fix:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
git diff --check
```
