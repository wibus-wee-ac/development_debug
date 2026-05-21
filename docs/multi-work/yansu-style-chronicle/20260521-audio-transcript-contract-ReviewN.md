# Yansu-Style Chronicle Audio Transcript Contract Review

## Verdict

Requires fixes.

The slice establishes a Chronicle-owned transcript ingest/list contract and avoids claiming that the Rust runtime performs real audio capture or ASR. However, the current implementation has contract and migration gaps that should be fixed before this slice is accepted.

## Findings

### High: Transcript ingest silently accepts invalid chronology and rewrites it to "now"

- References:
  - `apps/server/src/modules/chronicle/model.ts:191-212`
  - `apps/server/src/modules/chronicle/service.ts:1096-1101`
  - `apps/server/src/modules/chronicle/service.ts:1160-1172`
  - `apps/server/src/modules/chronicle/service.ts:2477-2484`
  - `apps/server/tests/chronicle.test.ts:350-411`

`audioTranscriptReportBody.startedAt` is only `minLength: 1`, and `recordAudioTranscript()` uses `parseTimestamp(input.startedAt) ?? now`. That means a malformed `startedAt` such as `"not-a-date"` is accepted and persisted using server receipt time. `endedAt` has the same permissive parse behavior, and there is no validation that `endedAt >= startedAt` or that each segment has `endMs >= startMs`.

For durable evidence, this is a data integrity bug: the timeline, status `lastAudioTranscriptAt`, and derived memory `createdAt` can all be silently wrong while the API returns 200. The existing positive-path test does not cover malformed dates or reversed segment ranges.

Recommended fix: reject invalid transcript timestamps with a 400 before persistence, and reject negative/reversed ranges at the report level. Add tests for invalid `startedAt`, invalid `endedAt`, `endedAt < startedAt`, and `segment.endMs < segment.startMs`.

### Medium: Migration handoff is incomplete relative to the actual journal/schema chain

- References:
  - `docs/multi-work/yansu-style-chronicle/20260521-audio-transcript-contract-SynthesisM.md`
  - `packages/db/drizzle/meta/_journal.json:180-199`
  - `packages/db/drizzle/0025_lowly_stature.sql:1`
  - `packages/db/drizzle/0026_perfect_korath.sql:1`
  - `packages/db/drizzle/0027_dazzling_vance_astro.sql:1`
  - `packages/db/src/schema/chronicle.ts:26-115`

The synthesis says the generated migration artifact is only `0027_dazzling_vance_astro.sql`, but the current journal adds `0025_lowly_stature`, `0026_perfect_korath`, and `0027_dazzling_vance_astro`. The schema also contains the memory chunk/keyword/embedding tables and `chronicle_memories.content_hash`, which are backed by `0025` and `0026`, not by `0027`.

This may be intentional cross-slice work, but the handoff as written is misleading and makes the audio transcript slice hard to review or land independently. If a reviewer or committer follows the handoff and includes only `0027`, the Drizzle journal will reference missing migrations or the schema/migration set will be inconsistent.

Recommended fix: either update the handoff/slice boundary to include `0025` and `0026` explicitly, or separate the audio transcript migration from the memory-index migrations so this contract slice has a self-contained schema delta.

### Medium: Rust transport types do not encode the server contract enums or confidence bounds

- References:
  - `chronicle/src/cradle_client.rs:88-118`
  - `apps/server/src/modules/chronicle/model.ts:194-208`

The server only accepts `source` values `asr | manual | imported`, `status` values `recording | completed | imported | error`, and `confidence` in `[0, 1]`. The Rust client exposes `source: String`, `status: String`, and `confidence: Option<f32>`, so callers can construct reports that serialize successfully but are guaranteed to be rejected by the server.

This is not a storage bug, but it weakens the "contract" claim: the Rust side is currently a JSON shape, not a typed contract. For a future daemon boundary, this will push validation failures to runtime and make regressions easier to miss.

Recommended fix: introduce Rust enums for transcript source/status with `serde(rename_all = "camelCase")` or explicit lowercase renames, and either use a bounded confidence constructor/newtype or validate reports before posting. Add serialization tests for all accepted enum variants and a negative/unit validation case if validation is local.

### Low: Tests prove the happy path but not idempotent rebuild semantics

- References:
  - `apps/server/src/modules/chronicle/service.ts:1103-1178`
  - `apps/server/tests/chronicle.test.ts:350-399`

The implementation intends to upsert a transcript by `sourceId` and rebuild ordered segments. The test only posts a transcript once. It does not prove that a second POST with the same `sourceId` deletes stale segments, preserves one transcript row, updates `memoryId`, and refreshes timeline/search content.

Recommended fix: add a test that posts `meeting-source-1` twice with a different segment set and asserts one transcript row, no stale segment text, updated segment count/order, and updated derived memory/search result.

## Ownership Review

The new persisted tables are under the `chronicle_*` namespace, and model resources are stored under Cradle/Chronicle data roots. That matches Cradle ownership rules: Chronicle owns transcript evidence and derived memory/index lifecycle. I did not see writes into external `~/.agents/skills` or other non-Cradle namespaces in this slice.

The only ownership concern is slice ownership/documentation: the audio transcript contract handoff currently bundles or depends on memory-index migrations without naming that dependency clearly.

## Review Notes

I reviewed the handoff and relevant current diff for:

- DB schema and Drizzle migration artifacts.
- Server route/model/service ingest/list/timeline/status behavior.
- Web display and adapter normalization for transcript entries.
- Rust HTTP transport structs and serialization tests.
- Server test coverage around transcript ingest/search/timeline/status.

I did not edit implementation files.
