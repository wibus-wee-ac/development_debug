# Chronicle Knowledge Crystallization Review AW

## Scope

Independent design review for the next Chronicle slice: Chronicle-owned knowledge cards, knowledge versions, crystallization runs, and dream merge run foundation.

Reviewed files:

- `docs/draft-solutions/yansu-chronicle-spec.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `packages/db/src/schema/chronicle.ts`
- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/index.ts`
- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`

No production code was edited in this review.

## Direct Conclusion

This slice should be blocked until it is explicitly framed as a schema-first Chronicle ownership slice, not as a prompt-only extension of `summarizeActivitySegment()`. The current code has activity segments, memories, memory chunks, lexical embeddings, and pipeline runs, but it does not yet have durable Chronicle-owned `knowledge` or `dream_runs` equivalents. Adding crystallization by only writing JSON into `chronicle_pipeline_runs.summary_results_json` or `chronicle_activity_segments.metadata_json` would make the feature visible in a demo but would fail the long-term ownership and idempotency requirements.

The recommended minimum implementation is:

1. Add Chronicle-owned Drizzle tables for knowledge cards, knowledge versions, knowledge source links, dream merge runs, and dream merge candidates/results.
2. Add a manual crystallize action for one summarized activity segment that produces durable knowledge cards and versions.
3. Add a manual dry-run dream merge action that records candidate clusters and proposed merges without rewriting memories.
4. Surface the results in Settings > Chronicle as inspectable knowledge cards and dream run history, while clearly labeling this as a foundation and not full Yansu parity.

## Blocking Risks

### Blocker 1: Missing Durable Chronicle-Owned Knowledge Schema

`packages/db/src/schema/chronicle.ts` currently has `chronicleMemories`, `chronicleMemoryChunks`, `chronicleMemoryEmbeddings`, `chronicleActivitySegments`, and `chroniclePipelineRuns`, but no knowledge card, knowledge version, knowledge source link, or dream run table. The Yansu spec's `knowledge`, `knowledge_versions`, and `dream_runs` tables are only described in the draft spec, not represented in Cradle's Drizzle schema.

Must not accept an implementation that stores knowledge cards only in:

- `chronicleActivitySegments.metadataJson`
- `chroniclePipelineRuns.summaryResultsJson`
- `chronicleMemories.metadataJson`
- filesystem markdown sidecars

Those locations can carry run metadata or source excerpts, but they cannot own lifecycle, version restore, card listing, source traceability, deletion, or future migrations.

Required acceptance criteria:

- New tables are declared in `packages/db/src/schema/chronicle.ts`, exported through the DB schema barrel, and generated through `pnpm exec drizzle-kit generate --config drizzle.config.ts`.
- Runtime migration chain includes SQL plus `meta/*_snapshot.json` and `_journal.json` updates. A hand-written orphan SQL file is not acceptable.
- Tables use the `chronicle_` namespace and do not write into `.agents`, provider profile storage, source-system namespaces, or generic agent memory namespaces.
- The directory README and file headers expected by the repo documentation rules are updated where new files are added.

### Blocker 2: Knowledge Card Identity and Version Semantics Need a Stable Contract

The spec's `KnowledgeCard` has `Title`, `Content`, `Dimension`, `Confidence`, `SourceChunks`, `Tags`, `Version`, and deletion state. The next slice must define how repeated crystallization changes a card. Without stable identity, every retry can create duplicate cards; without versions, edits and dream merges cannot be audited or restored.

Required acceptance criteria:

- `chronicle_knowledge_cards` has durable fields for `id`, `workspace_id`, `title`, `content`, `dimension`, `confidence_bps`, `card_type`, `tags_json`, `source_kind`, `status`, `version`, `is_deleted`, `is_pinned`, `created_at`, and `updated_at`.
- Confidence should be stored as an integer basis-point style value, not a lossy string or unconstrained floating value, to match existing SQLite/TypeScript patterns.
- `chronicle_knowledge_versions` records every material card mutation with `knowledge_id`, `version`, previous/current card fields, source run id, model/profile ids, and timestamp.
- Source traceability is normalized through a link table such as `chronicle_knowledge_sources`, with references to `memory_id`, `memory_chunk_id`, `segment_id`, `pipeline_run_id`, and optional source evidence ids. Do not store only a JSON array of source chunk ids.
- Card creation/upsert has an explicit stable dedup key. Good candidates are normalized title/content hash plus dimension and workspace, or an LLM-supplied `stable_key` that is validated and then salted with source context. Raw `Date.now()` ids alone are insufficient.
- Re-running crystallization over unchanged evidence returns the same card ids and does not increment versions unless card content changed.

### Blocker 3: Crystallization Run Must Be Idempotent Across Model Failures and Retries

Current `triageActivitySegment()` and `summarizeActivitySegment()` already use `sourceKey` values based on an evidence hash. The new crystallization stage must follow the same pattern, but with stricter output handling because it will write multiple rows and versions after an LLM call.

Required acceptance criteria:

- The crystallization endpoint creates or reuses one `chronicle_pipeline_runs` row with stage `crystallization`, status transitions `running -> success | error | skipped`, and a source key shaped by segment id plus immutable source evidence revision.
- If the model profile is missing, API key is missing, JSON parsing fails, validation fails, or the provider times out, the run is marked `error` with a useful `error_message`; no partial knowledge cards or versions remain.
- LLM output parsing is schema-validated with constrained enums for card type and dimension. Invalid cards are rejected or recorded as validation errors; they are not silently persisted.
- DB writes for cards, versions, source links, segment `pipelineStatus`, and run result JSON occur in one transaction after the model call returns and validates.
- A retry after a failed run must be possible without requiring manual DB cleanup. A retry after a successful run with unchanged evidence must be idempotent and return the prior result.
- Usage, model id, profile id, prompt version, prompt hash, evidence hash, and output parse status are recorded in the run metadata.
- Concurrent clicks on the same crystallize action do not create duplicate runs or duplicate card versions. This likely requires using the existing unique `sourceKey` plus transactional upsert behavior around the final write.

### Blocker 4: Dream Merge Foundation Must Not Mutate Memory or Knowledge by Default

The Yansu `DreamEngine` includes merge, archive, prune, restore, and dry-run modes. Cradle should not claim full dream behavior in this slice. The safe foundation is a recorded dry-run merge analysis and, at most, an explicit proposed merge result.

Required acceptance criteria:

- Add a Chronicle-owned dream run table such as `chronicle_dream_runs` with `run_type`, `status`, `started_at`, `ended_at`, `input_count`, `candidate_count`, `merged_count`, `config_json`, `result_json`, `error_message`, and timestamps.
- Add normalized candidate/result rows if the UI needs drilldown. Do not rely only on a huge `result_json` blob for user-visible candidate details.
- The first endpoint is named and documented as dry-run, for example `POST /chronicle/dream-runs` with `mode: "dry-run"` and `runType: "merge"`.
- Dry-run dream merge must not modify `chronicle_memories`, `chronicle_memory_chunks`, `chronicle_knowledge_cards`, `is_deleted`, `is_merged`, or any canonical content.
- If a non-dry-run merge endpoint is added, it must be explicitly gated and must create reversible versions before mutation. That is out of scope for the foundation.
- Candidate scoring must declare whether it uses current `chronicle-lexical/v1` vectors or future ONNX embeddings. UI copy must not imply neural semantic merge when only lexical vectors are used.

### Blocker 5: Minimal UI Must Make the Slice Usable, Not Just Technically Present

Settings > Chronicle currently exposes runtime status, Slack, local model resources, accessibility evidence, audio evidence, timeline, activity segments, pipeline runs, and memories. The new slice is not directly usable unless a user can trigger crystallization and inspect resulting knowledge cards.

Required acceptance criteria:

- Activity Segments list shows a `Crystallize` action only when the segment is summarized or has sufficient evidence. It should show disabled or error states for missing model config.
- Knowledge Cards section lists recent cards with title, dimension, type, confidence, tags, source segment/memory reference, version, and updated time.
- User can filter or scan cards by dimension/type at minimum. Full search can be deferred if list size is bounded and recent-first.
- Dream Runs section lists dry-run merge history with status, candidate count, model/vector mode, start/end time, and error message.
- UI copy must say "Knowledge Cards" and "Dream Merge Dry Run" or equivalent. It must not claim full Yansu parity, automatic background dream scheduling, restore, archive, prune, or real neural dedup if those are not implemented.
- Status panel should expose counts for knowledge cards and dream runs, otherwise the feature looks disconnected from the existing Chronicle status loop.

## Must-Have API Shape

The exact route names can follow local style, but the next slice needs these capabilities:

- `POST /chronicle/activity-segments/:segmentId/crystallize`
  - Runs crystallization over one activity segment.
  - Returns the pipeline run, updated segment, and created/updated knowledge cards.

- `GET /chronicle/knowledge-cards`
  - Lists cards, recent first, with optional `limit`, `dimension`, `type`, and `includeDeleted` query parameters.

- `GET /chronicle/knowledge-cards/:cardId`
  - Returns detail including source links and current version.

- `GET /chronicle/knowledge-cards/:cardId/versions`
  - Lists versions for audit and later restore.

- `POST /chronicle/dream-runs`
  - Starts a dry-run merge analysis with bounded input size.

- `GET /chronicle/dream-runs`
  - Lists run history.

API responses should be added to `apps/server/src/modules/chronicle/model.ts` rather than returning untyped ad hoc JSON. Web hook types in `apps/web/src/features/chronicle/use-chronicle.ts` should be the single compatibility boundary until generated SDK refresh is intentional.

## Schema-First Checklist

Required before implementation is accepted:

- Drizzle schema definitions exist for every new table.
- Generated migration artifacts are committed together.
- Foreign keys use Chronicle-owned tables where possible:
  - cards to `workspaces`
  - versions to cards
  - source links to cards, segments, memories, memory chunks, and pipeline runs
  - dream candidates to dream runs
- Indexes exist for common UI and idempotency paths:
  - card workspace plus updated time
  - card dimension/type/status
  - stable dedup key or content hash
  - versions by card/version
  - source links by segment/memory/chunk
  - dream runs by started time/status
- Deletion behavior is explicit. Prefer soft delete for knowledge cards and cascade for source links/versions only where audit requirements are preserved.
- JSON fields are used for flexible metadata, not for primary ownership relationships.

## Model-Call and Parsing Acceptance Criteria

Crystallization should use a new prompt builder, not reuse the summarization prompt. The output should be constrained to structured JSON:

- top-level `summary`
- `knowledgeCards`
- optional `tags`
- optional rejected/noise reason

Each card must validate:

- `title`: non-empty bounded string
- `content`: non-empty bounded string
- `type`: `fact | insight | decision | task | pattern`
- `dimension`: `technical | business | personal | project`
- `confidence`: number from `0` to `1`, stored as bps
- `source`: `activity | chat | meeting | inference`
- `tags`: bounded string array

Failure behavior:

- Provider config missing: no model call, run `error`.
- Timeout/provider error: run `error`, no card writes.
- Invalid JSON: run `error`, raw output stored only in bounded run metadata or event attrs if size-safe.
- Some cards invalid: either fail the whole run or persist only valid cards while recording rejected count. Pick one policy and test it.
- Empty useful cards: run `skipped` or `success` with zero cards, but segment should not be marked `crystallized`.

## Idempotency Contract

The slice should define three separate keys:

- `evidenceHash`: derived from segment id/time range, source refs, and source evidence `updatedAt` versions. It should exclude derived segment `summary`, `title`, and crystallization metadata unless those are intentionally considered input.
- `runSourceKey`: `activity-segment:{segmentId}:crystallization:{evidenceHash}:prompt:{promptVersion}`.
- `cardStableKey`: deterministic normalized key for a card within workspace and dimension/type.

Acceptance tests should prove:

- Same segment and same evidence creates one successful crystallization run.
- Re-clicking crystallize returns the same run and card ids.
- Changed evidence creates a new run.
- Changed LLM card content for the same stable key creates one new version, not a second card.
- Failed run can be retried.
- Two concurrent requests do not double-insert cards or versions.

## Minimal User-Visible Slice

The smallest directly usable slice is:

1. User captures or imports evidence.
2. User summarizes an activity segment with the existing action.
3. User clicks `Crystallize` on that segment.
4. UI shows resulting Knowledge Cards.
5. User opens a card and sees source segment/memory and version number.
6. User starts a Dream Merge Dry Run.
7. UI shows run history and candidate count, without changing memories.

This is useful without claiming:

- automatic background crystallization
- full Yansu `DreamEngine`
- archive/prune/restore
- real ONNX embedding merge
- autonomous agent use of knowledge cards

## Recommended Tests

Server tests:

- Migration smoke on a fresh database includes all new Chronicle tables.
- `crystallizeActivitySegment()` rejects missing segment with 404.
- Missing model config records an error run and writes no cards.
- Invalid model JSON records an error run and writes no cards.
- Valid model JSON creates cards, versions, source links, marks segment `crystallized`, and records usage.
- Re-running same evidence is idempotent.
- Same card stable key with changed content increments version.
- Dream merge dry-run records candidates but does not mutate memories/cards.

Web tests or focused UI verification:

- Settings shows `Crystallize` action and loading/error states.
- Knowledge Cards section renders empty, loading, and populated states.
- Dream Runs section renders dry-run results and errors.
- UI labels do not imply full Yansu parity.

Commands expected for validation:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```

If web generated SDK files are intentionally refreshed, also run the relevant API generation command and review unrelated generated churn separately.

## Non-Blocking Design Notes

- `chronicleEvents.type` currently lacks `knowledge` and `dream`. Adding those enum values is cleaner than recording everything as `activity` or `memory`.
- Existing `chroniclePipelineRuns.stage` already includes `crystallization`, so the next slice can reuse pipeline run history instead of inventing a parallel crystallization log. It still needs first-class knowledge tables.
- Current memory embeddings use `chronicle-lexical/v1`. Dream merge UI and metadata should expose that model id to avoid overstating semantic quality.
- `chronicleMemories.type` is limited to `10min | 6h`; knowledge cards should not be forced into that memory type system.
- Consider a bounded prompt/evidence length policy before crystallization. The current segment context can include OCR, Slack, transcript, raw audio metadata, and memories, so the model call needs deterministic truncation with source accounting.

## Review Verdict

Do not proceed with a production implementation that only adds prompt text and JSON blobs. Proceed when the design includes Chronicle-owned schema, deterministic run/card identity, transactional writes after model validation, dry-run-only dream merge behavior, and a Settings UI that lets users inspect cards and runs without claiming full Yansu parity.
