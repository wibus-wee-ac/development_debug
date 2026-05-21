# Activity Triage/Summarization Re-Review AV

## Result

复审结论：Pass。当前 Chronicle activity triage/summarization slice 覆盖了 ReviewAT 的高严重度要求；未发现需要阻塞合入的 server route/schema、Web action wiring 或测试回归。

本次复审只写入此交接文件，未修改 production code。

## Files Reviewed

- `docs/multi-work/yansu-style-chronicle/20260521-activity-triage-summary-ReviewAT.md`
- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/tests/chronicle.test.ts`
- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`
- `apps/server/src/modules/chronicle/README.md`
- `apps/web/src/features/chronicle/README.md`

## Acceptance Criteria Review

1. No false success on model/config failure: Pass.

   `triageActivitySegment()` and `summarizeActivitySegment()` create or reuse a stage run, resolve the Chronicle model context, and route config/model failures through `failActivityPipelineRun()` instead of writing success state. Model call exceptions are caught and also flow through the same failure path. The failure helper sets the segment `pipelineStatus` to `error`, run `status` to `error`, preserves `errorMessage`, records an activity error event, and returns response `status: 'error'`.

   Evidence: `apps/server/src/modules/chronicle/service.ts:1446`, `apps/server/src/modules/chronicle/service.ts:1463`, `apps/server/src/modules/chronicle/service.ts:1532`, `apps/server/src/modules/chronicle/service.ts:1538`, `apps/server/src/modules/chronicle/service.ts:1563`, `apps/server/src/modules/chronicle/service.ts:1936`.

   Test coverage includes an unconfigured triage request asserting response `status: 'error'`, segment `pipelineStatus: 'error'`, run `status: 'error'`, run stage `triage`, and `errorMessage`.

   Evidence: `apps/server/tests/chronicle.test.ts:1071`.

2. Idempotent retries: Pass.

   The implementation uses segment/stage/evidence-scoped source keys for triage and summarization, checks completed `success` or `skipped` runs before executing model calls, and upserts by the unique source key for in-progress/error retry reuse. The summarization path returns the existing completed run and memory id on duplicate calls.

   Evidence: `apps/server/src/modules/chronicle/service.ts:1448`, `apps/server/src/modules/chronicle/service.ts:1548`, `apps/server/src/modules/chronicle/service.ts:1660`, `apps/server/src/modules/chronicle/service.ts:1880`.

   Test coverage calls summarize twice for the same segment, asserts the second response returns the same memory id, keeps the model call count at two total calls, preserves activity segment count, and leaves one summarization pipeline run for the segment/evidence source key.

   Evidence: `apps/server/tests/chronicle.test.ts:1175`.

3. No recursive activity assignment from summary memory: Pass.

   Summarization-created memories call `recordMemory()` with `skipActivityAssignment: true`, and `assignMemoryToActivity()` exits immediately when that flag is present. This prevents the generated summary memory from feeding back into segmentation as new memory-triggered activity.

   Evidence: `apps/server/src/modules/chronicle/service.ts:1579`, `apps/server/src/modules/chronicle/service.ts:1599`, `apps/server/src/modules/chronicle/service.ts:3088`.

   Test coverage records the segment count after summary creation, repeats summarization, and asserts no new activity segment was created by the summary memory path.

   Evidence: `apps/server/tests/chronicle.test.ts:1175`.

4. Evidence hash does not drift due to segment summary/title writes: Pass.

   `getActivitySegmentContext()` includes segment title and existing summary in prompt evidence, but `buildActivityEvidenceHash()` does not hash title, summary, metadata, pipeline status, or segment `updatedAt`. It hashes segment id, started/ended time, normalized source refs, and source evidence versions from underlying evidence rows. Therefore triage title writes and summarization summary/title writes do not change the source key by themselves.

   Evidence: `apps/server/src/modules/chronicle/service.ts:1682`, `apps/server/src/modules/chronicle/service.ts:1820`, `apps/server/src/modules/chronicle/service.ts:1836`.

5. No Drizzle schema change needed for this slice: Pass.

   The triage/summarization implementation uses already available Chronicle activity and pipeline columns: segment `summary`, `title`, `pipelineStatus`, `metadataJson`; pipeline run `sourceKey`, `stage`, `status`, `triageResultsJson`, `summaryResultsJson`, `memoryIdsJson`, `metadataJson`, and `errorMessage`; plus existing memory rows for searchable summaries. I did not find a slice-specific need for new Drizzle columns.

   Note: the current worktree has broader Chronicle foundation schema diffs in `packages/db/src/schema/chronicle.ts` relative to the repository baseline, but this re-review treats those as pre-existing foundation work. The reviewed triage/summarization slice itself does not require an additional schema change beyond those existing columns.

6. Server route/schema: Pass.

   Server routes are narrow, Chronicle-owned endpoints under `/chronicle/activity-segments/:segmentId/triage` and `/chronicle/activity-segments/:segmentId/summarize`, with params and response schemas. The response schema includes segment, run, nullable memory id, action status, and message, matching the service return shape.

   Evidence: `apps/server/src/modules/chronicle/index.ts:142`, `apps/server/src/modules/chronicle/index.ts:147`, `apps/server/src/modules/chronicle/model.ts:341`.

7. Web action wiring: Pass.

   Web hooks call the new triage and summarize endpoints with encoded segment ids, normalize the action payload, and invalidate activity segments, pipeline runs, status, memories, and memory search queries after success. The settings UI wires the actions to per-segment Triage and Summarize buttons and disables actions when a segment is already summarized or crystallized.

   Evidence: `apps/web/src/features/chronicle/use-chronicle.ts:1245`, `apps/web/src/features/chronicle/chronicle-settings.tsx:1093`, `apps/web/src/features/chronicle/chronicle-settings.tsx:1201`.

8. README updates: Pass.

   Both Chronicle server and Web feature READMEs document activity segment triage/summarization routes/actions, pipeline runs, idempotent source keys, failure semantics, and current non-goals.

## Blocking Findings

None.

## Non-Blocking Notes

- The tests cover config failure and successful idempotent summarization. They do not explicitly mock `generateText()` rejection for triage or summarization after model context resolution. The service failure path is shared and appears correct, but a targeted rejection test would make the ReviewAT model-call failure criterion harder to regress.
- Summarization memory `sourceId` is stable per segment rather than per evidence hash. That is acceptable for same-evidence retries and prevents duplicate memories, but if the product later wants multiple historical summaries for changed evidence on the same segment, the memory source id policy will need to include the evidence hash or store revisions elsewhere.

## Verification

Static review only. I did not run the test suite or typecheck in this re-review turn.
