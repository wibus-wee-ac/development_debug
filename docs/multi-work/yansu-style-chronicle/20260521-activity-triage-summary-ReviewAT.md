# Activity Segment Triage + Summary Review

## Result

独立评审结果：当前 activity pipeline foundation 可以作为 triage + summarization 的输入层，但计划中的下一片如果直接加端点，存在 blocking 语义风险。实现前应先明确 endpoint 状态机、模型失败语义、幂等 key，以及 memory 写入是否允许反向触发 segmentation。

本评审只读取并分析以下文件，未修改生产代码：

- `docs/draft-solutions/yansu-chronicle-spec.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/tests/chronicle.test.ts`
- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`

## Blocking Findings

1. High: planned triage/summarization endpoints must not treat model-call failures as successful pipeline progress.

   Existing `/chronicle/summarize` returns HTTP 200 with `{ status: 'error', memoryId: null }` on config/model/API failure and records an error event. That is acceptable for the current daemon-facing summary path, but a pipeline endpoint that updates `chronicle_activity_segments.pipeline_status` or `chronicle_pipeline_runs.status` must not advance a segment to `triaged` or `summarized` unless the model call completed and the result was persisted. The new endpoint should write `chronicle_pipeline_runs.status = 'error'`, `errorMessage`, and an error event on failure, while leaving the segment at its previous status or setting `pipelineStatus = 'error'` only if the UI should surface a hard failure.

   Required test: force `generateText()` or summary config validation to fail and assert no segment summary is written, no memory row is created, no `summaryResultsJson` success payload is stored, and no `pipelineStatus = 'summarized'` appears.

2. High: endpoint idempotency must be segment-scoped, not request-time scoped.

   Current collection/segmentation runs have `sourceKey` and unique `chronicle_pipeline_runs_source_key_unique`; this fixed duplicate segmentation runs. Triage/summarization need the same discipline. A retry of `POST /chronicle/activity-segments/:segmentId/triage` or `.../summarize` must update/reuse the same logical run instead of creating a new run and must not create duplicate memories. A source key such as `triage:segment:<segmentId>:<evidenceRevision>` and `summarization:segment:<segmentId>:<triageRevision|evidenceRevision>` is needed before implementation.

   Required test: call the endpoint twice for the same segment and assert one logical pipeline run for that stage and one final memory/summary effect.

3. High: summarization-created memories can recursively create new activity evidence unless explicitly suppressed.

   `recordMemory()` calls `assignMemoryToActivity()` by default. Existing transcript and Slack paths avoid recursion with `skipActivityAssignment: true` and then assign the original evidence explicitly. Segment summarization should do the same: either store the segment summary directly on `chronicle_activity_segments.summary` without creating a memory, or if it crystallizes into `chronicle_memories`, call `recordMemory(..., { skipActivityAssignment: true })` and then attach the produced memory id to the existing segment/pipeline result. Otherwise the generated memory can create a new `memory`-triggered segment/run, causing duplicate or self-referential pipeline activity.

   Required test: summarize an existing segment and assert the activity segment count does not increase solely because the summary memory was created.

4. High: evidence snapshots used by the model must be frozen or versioned for idempotent retries.

   Activity segments are mutable while new evidence is appended. The existing `sourceRefsJson`, `sourceCountsJson`, `summary`, `metadataJson`, and pipeline result JSON columns are enough to implement this slice without a schema change, but the endpoint must decide whether it operates on the current segment or on a frozen evidence list. If retrying after more snapshots/messages have appended to the same segment uses a different prompt under the same idempotency key, the pipeline can silently overwrite an older result with a different result.

   Recommended fix: store the exact evidence ids and a prompt/content hash in `chronicle_pipeline_runs.summaryResultsJson` or `metadataJson`; include that hash in the stage source key if the endpoint is allowed to recompute after evidence changes.

## Schema / Drizzle Review

No DB schema change is required for the first triage + summarization endpoints.

Existing columns are already sufficient:

- `chronicle_activity_segments.summary` for the segment summary text.
- `chronicle_activity_segments.pipelineStatus` for `collecting -> triaged -> summarized -> error`.
- `chronicle_activity_segments.metadataJson` for compact triage metadata such as keep/discard decision, confidence, labels, reason, evidence hash, and model id.
- `chronicle_pipeline_runs.triageResultsJson` and `summaryResultsJson` for structured model outputs.
- `chronicle_pipeline_runs.errorMessage`, `status`, `stage`, `sourceKey`, and count/id JSON fields for observability and idempotency.
- `chronicle_memories` for durable crystallized summaries only if the slice intentionally creates user-searchable memories.

If a schema change becomes necessary, it must start in `packages/db/src/schema/chronicle.ts` and then be generated through Drizzle Kit. Do not hand-write an orphan SQL migration.

## Endpoint Shape Recommendation

Use narrow Server-owned endpoints in `apps/server/src/modules/chronicle/index.ts` backed by service functions:

- `POST /chronicle/activity-segments/:segmentId/triage`
- `POST /chronicle/activity-segments/:segmentId/summarize`

The body can be minimal for the first slice: optional `force`, optional `createMemory`, and optional prompt/profile override only if the product actually needs override semantics. Prefer existing Chronicle config by default so model ownership stays in Chronicle settings.

Responses should include:

- segment id
- pipeline run id
- status: `success | skipped | error`
- triage decision for triage
- summary and optional memory id for summarization
- error message when status is `error`

Avoid returning a successful HTTP response body that looks like completion if the model failed. If the repo convention keeps HTTP 200 for handled model failures, the JSON `status` must remain `error` and no durable success state may be written.

## Recursion Guard

When summarization creates memories, use this rule:

- Segment summary writes update the existing segment.
- Crystallized memory writes use a deterministic `sourceId`, for example `activity-segment-summary:<segmentId>:<evidenceHash>`.
- `recordMemory()` is called with `skipActivityAssignment: true`.
- The existing segment's `sourceRefsJson.memoryIds` or the pipeline run's `memoryIdsJson` is updated to reference the memory.

This keeps the generated memory attached to its source segment without feeding it back into segmentation as new user activity.

## Validation Checklist

Server tests should cover:

- triage success writes one triage pipeline run and sets segment `pipelineStatus = 'triaged'`.
- triage skip/discard records `skipped` or a clear triage result without creating a memory.
- triage model failure records an error run/event and does not mark success.
- summarization success writes segment `summary`, one summary run, and optionally one deterministic memory.
- summarization retry is idempotent.
- summarization model failure writes no summary/memory and does not report false success.
- summary-created memory does not create a new memory-triggered activity segment.
- no schema drift: `pnpm exec drizzle-kit generate --config drizzle.config.ts` should report no changes if no schema edit is made.

Focused commands after implementation:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

## Non-Blocking Notes

- The Web UI already understands `triaged`, `summarized`, `crystallized`, and pipeline stages, but it only displays them. A manual trigger UI is optional for the first Server slice.
- Current segmentation runs intentionally remain `running` with pending downstream stages. Triage/summarization should either update those existing stage records carefully or create separate stage-specific records; do not retroactively mark segmentation as full-pipeline success.
- `chronicle_activity_segments.summary` currently may contain OCR/transcript preview text from collection. Segment summarization should distinguish raw preview from model summary, likely through `metadataJson.summaryKind` or by overwriting only after successful summarization.
