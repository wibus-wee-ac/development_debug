# Activity Pipeline Foundation Synthesis

## Scope

This slice adds the first Chronicle-owned Activity Pipeline foundation from the Yansu spec:

- `chronicle_activity_sessions`
- `chronicle_activity_segments`
- `chronicle_pipeline_runs`
- `GET /chronicle/activity-segments`
- `GET /chronicle/pipeline-runs`
- Settings > Chronicle `Activity Segments` panel

It intentionally covers collection and segmentation only. It does not claim triage, segment summarization, crystallization, or dream merge readiness.

## Implementation

Database changes are Drizzle schema-first:

1. Updated `packages/db/src/schema/chronicle.ts`.
2. Ran `pnpm exec drizzle-kit generate --config drizzle.config.ts`.
3. Generated `packages/db/drizzle/0030_dazzling_blackheart.sql` and `packages/db/drizzle/meta/0030_snapshot.json`.

Server changes:

- Added activity session, activity segment, and pipeline run schemas.
- Added a pipeline run `sourceKey` unique key so repeated evidence reports update the existing run instead of creating duplicate successful-looking rows.
- Added status totals for activity segments and pipeline runs.
- Added `listActivitySegments()` and `listPipelineRuns()`.
- Added routes:
  - `GET /chronicle/activity-segments`
  - `GET /chronicle/pipeline-runs`
- Added activity assignment at canonical ingest points:
  - `recordSnapshot()`
  - `recordSlackMessage()`
  - `recordAudioRawSegment()`
  - `recordAudioTranscript()`
  - direct `recordMemory()` calls
- Kept Slack polling and Slack Events API on the shared `recordSlackMessage()` path, so duplicates do not double-assign.
- Kept raw audio and transcript updates idempotent by assigning activity evidence only on first source insert.
- Recorded current segmentation runs as `running` with pending downstream stages instead of `success`, because triage, summarization, and crystallization are not implemented yet.

Web changes:

- Added typed adapters and hooks:
  - `useChronicleActivitySegments()`
  - `useChroniclePipelineRuns()`
- Added runtime status counts for activity and pipeline records.
- Added `Activity Segments` section between Timeline and Memories.
- Displayed recent segment source counts and pipeline run trigger/stage/status without claiming later Yansu stages are complete.

## Behavioral Evidence

The server test now proves:

- A snapshot with accessibility evidence creates an activity segment with `snapshotIds` and `accessibilitySnapshotIds`.
- Duplicate snapshot source ingest does not duplicate snapshot rows or snapshot-trigger pipeline runs.
- Audio transcript ingest creates a meeting segment and links the derived memory id.
- Transcript source update rebuilds transcript text without duplicating activity assignment.
- Raw audio segment ingest creates an audio activity segment.
- Raw audio source update remains one DB row and does not produce duplicate source refs.
- Slack polling inserts one message, links the Slack-derived memory to a chat activity segment, and duplicate sync imports zero new messages.
- `/chronicle/activity-segments` exposes source counts.
- `/chronicle/pipeline-runs` exposes snapshot/message/audio-transcript/audio-raw segmentation runs.
- `/chronicle/status` includes activity and pipeline totals.
- Direct memory updates do not create duplicate pipeline runs for the same memory evidence.
- Backfilled same-title snapshots do not merge into a later segment when their timestamp is earlier than that segment.

## Validation

Passed:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

## Remaining Gaps

This slice does not complete the full Yansu Activity Pipeline. Still missing:

- AXObserver notification lifecycle.
- System audio capture.
- Real VAD, ASR, and speaker embedding runtime.
- Activity triage agent.
- Per-segment LLM summarization.
- Knowledge cards, crystals, and dream merge.
- ONNX embedding runtime and semantic duplicate merge by vector similarity.
- Solve-layer agent search and automation integration.
