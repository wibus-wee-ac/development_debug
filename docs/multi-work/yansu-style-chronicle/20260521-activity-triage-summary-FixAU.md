# Activity Triage and Summary Fix Report

## Review Input

This fix report responds to `docs/multi-work/yansu-style-chronicle/20260521-activity-triage-summary-ReviewAT.md`.

ReviewAT raised four high-severity risks:

1. Model/config failures must not advance `pipelineStatus` or pipeline run status to a success state.
2. Endpoints must be idempotent by segment, stage, and evidence revision.
3. Summary-created memories must not recursively create new activity segments or pipeline runs.
4. Evidence is mutable, so retry keys must not overwrite results created from different inputs.

## Fixes Applied

No false success:

- `triageActivitySegment()` and `summarizeActivitySegment()` resolve the Chronicle model context before running model work.
- If Chronicle is disabled, the profile is missing, the API key is missing, or the model call throws, the implementation calls `failActivityPipelineRun()`.
- `failActivityPipelineRun()` sets:
  - `chronicle_activity_segments.pipeline_status = 'error'`
  - `chronicle_pipeline_runs.status = 'error'`
  - `chronicle_pipeline_runs.error_message = message`
- The endpoint response returns `status: 'error'`.

Idempotency:

- Each manual stage creates or reuses a `sourceKey` shaped as `activity-segment:${segmentId}:${stage}:${evidenceHash}`.
- `getCompletedActivityPipelineRun()` returns existing `success` or `skipped` runs without calling the model again.
- The focused Chronicle test asserts a duplicate summarize call returns the same memory id and leaves `generateText` call count unchanged.

No recursion:

- Summarization writes memory through:

    recordMemory(..., { skipActivityAssignment: true })

- The focused Chronicle test records the activity segment count after summary creation and proves the duplicate summarize path does not create new segments.

Evidence revision:

- `evidenceHash` is computed from segment identity, segment time range, normalized source refs, and the source evidence rows' `updatedAt` values.
- It deliberately excludes segment summary/title/pipeline metadata. This prevents a successful summary write from changing its own retry key.
- If source evidence changes, the source row version changes and a new key is produced for the new input.

## Validation Evidence

Commands run from `/Users/wibus/dev/Cradle` after fixes:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

## Known Limitations

This is still a manual activity pipeline slice. It does not include automatic background scheduling, crystals, dream merge, or solve-layer integration. It is intentionally schema-free for this slice; any future schema expansion must start in `packages/db/src/schema/chronicle.ts` and then run `pnpm exec drizzle-kit generate --config drizzle.config.ts`.
