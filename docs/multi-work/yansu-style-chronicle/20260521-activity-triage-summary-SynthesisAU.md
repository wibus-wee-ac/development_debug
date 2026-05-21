# Activity Triage and Summary Synthesis

## Scope

This handoff covers the Activity Segment triage and summarization slice for Cradle Chronicle. The slice advances the Yansu-style pipeline from collection/segmentation into model-backed interpretation:

- Activity segments can be triaged through `POST /chronicle/activity-segments/:segmentId/triage`.
- Activity segments can be summarized through `POST /chronicle/activity-segments/:segmentId/summarize`.
- Summaries are persisted as Chronicle memories and become searchable through the existing memory index.
- Settings > Chronicle exposes Triage and Summarize buttons on each activity segment card.

This slice intentionally does not add a database migration. It uses existing `chronicle_activity_segments.summary`, `chronicle_activity_segments.metadata_json`, `chronicle_activity_segments.pipeline_status`, `chronicle_pipeline_runs.triage_results_json`, `chronicle_pipeline_runs.summary_results_json`, `chronicle_pipeline_runs.metadata_json`, and `chronicle_pipeline_runs.source_key`.

## Implemented Behavior

Server route changes:

- `apps/server/src/modules/chronicle/index.ts` now exposes:
  - `POST /chronicle/activity-segments/:segmentId/triage`
  - `POST /chronicle/activity-segments/:segmentId/summarize`

Server schema changes:

- `apps/server/src/modules/chronicle/model.ts` now defines `activityPipelineAction`, returning the updated segment, the pipeline run, nullable memory id, status, and message.

Server service behavior:

- `triageActivitySegment()` builds a segment context from existing source refs:
  - snapshots
  - accessibility snapshots
  - Slack messages
  - audio transcripts
  - raw audio segments
  - memories
- It calls the configured Chronicle profile/model using the existing AI SDK provider path.
- It writes successful triage output to the segment metadata and `chronicle_pipeline_runs.triage_results_json`.
- It marks skipped segments as `skipped` in the run rather than pretending they were summarized.
- It marks config/model failures as `error` on both the segment and run.

- `summarizeActivitySegment()` first reuses or runs triage.
- If triage skipped or errored, it returns that result without running summarization.
- On success, it calls the configured model for a structured summary.
- It writes the segment summary and writes a searchable memory through `recordMemory(..., { skipActivityAssignment: true })`.
- It writes summary output to `chronicle_pipeline_runs.summary_results_json`.

Idempotency:

- Pipeline source keys are `activity-segment:${segmentId}:${stage}:${evidenceHash}`.
- `evidenceHash` depends on segment id, segment time range, source refs, and source evidence `updatedAt` versions.
- It does not depend on `chronicle_activity_segments.summary`, title updates, or pipeline metadata writes, so a successful summarization does not change its own retry key.
- If a successful or skipped run already exists for the same segment/stage/evidence hash, the endpoint returns the existing result without calling the model again.

Web behavior:

- `apps/web/src/features/chronicle/use-chronicle.ts` now exposes `useChronicleActivityPipelineActions()`.
- `apps/web/src/features/chronicle/chronicle-settings.tsx` adds Triage and Summarize buttons to each Activity Segment card.
- Successful actions invalidate activity segments, pipeline runs, status, memories, and memory search queries.
- Pipeline run cards show error messages when present.

## Validation

Commands run from `/Users/wibus/dev/Cradle`:

    pnpm exec drizzle-kit generate --config drizzle.config.ts
    passed with "No schema changes, nothing to migrate"

    pnpm --filter @cradle/server exec tsc --noEmit
    passed

    pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
    passed

    pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
    passed

The Chronicle server test now covers:

- Missing Chronicle model config records a triage error instead of false success.
- Mocked model triage updates segment status/type/title and run metadata.
- Mocked model summarization creates a searchable Chronicle memory.
- Summary memory uses `skipActivityAssignment: true`, so it does not create a recursive activity segment.
- Re-running summarize over unchanged evidence returns the existing run/memory and does not call the model again.
- There is only one summarization pipeline run for the unchanged evidence hash.

## Remaining Work

This slice does not complete Yansu parity. Remaining gaps include:

- Knowledge cards / crystals.
- Dream merge.
- Automatic background pipeline scheduling.
- Semantic duplicate merge by real embeddings.
- AXObserver lifecycle.
- System audio capture.
- Real VAD / ASR / speaker runtime.
- Solve-layer integration with agents, MCP, handoff manager, cron, and computer-use.
