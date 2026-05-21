# Raw Audio Segments Review AH

## Findings

No blocking findings.

### Medium

- `apps/server/src/modules/chronicle/service.ts:2996`: raw audio segment `recordedAt` validation still accepts whitespace-only strings as Unix epoch `0`.
  - Evidence: `readRequiredAudioRawSegmentTimestamp()` delegates to `parseTimestamp()`. `parseTimestamp()` first tries `Date.parse(...)`, then falls back to `Number(value)`. For a value such as `" "`, `Date.parse()` fails but `Number(" ")` is `0`, so the endpoint persists a row at `1970-01-01T00:00:00Z` instead of rejecting the invalid timestamp.
  - Impact: malformed daemon or third-party reports can pollute status/list ordering with epoch timestamps. This does not break the happy path because Rust sends ISO timestamps, but the API validation is weaker than the route contract implies.
  - Recommended fix: trim timestamp input before parsing and reject empty strings; if numeric timestamps are intentionally supported, only accept trimmed digit strings with a reasonable lower bound.
  - Suggested coverage: add a POST `/chronicle/audio-raw-segments` test with `recordedAt: " "` and assert HTTP 400.

### Low / Test Gaps

- Rust best-effort reporting is behaviorally present, but not covered by a focused failure test for raw audio segment reporting.
  - Evidence: `chronicle/src/daemon.rs:402` catches `client.record_audio_raw_segment()` errors and logs "keeping local artifacts"; there is no deletion path in this function. Existing tests cover serialization/validation and artifact writing, but I did not find a daemon-level test that simulates Server failure after WAV/JSON write and asserts artifacts remain.
  - Recommended coverage: inject or mock a failing `CradleClient` path around `report_audio_raw_segment()` or add a narrow unit boundary that proves reporting failure is non-fatal after artifact creation.

## Validation Reviewed

- DB schema-first path:
  - Reviewed `packages/db/src/schema/chronicle.ts` and `packages/db/drizzle/0028_chief_clea.sql`.
  - `chronicleAudioRawSegments` exists in the Drizzle schema and migration `0028_chief_clea.sql` creates the matching table/index set.
  - `packages/db/drizzle/meta/_journal.json` contains `0028_chief_clea`, and `packages/db/drizzle/meta/0028_snapshot.json` contains `chronicle_audio_raw_segments`.
  - I did not find a hand-written orphan SQL file for this slice in the reviewed paths.

- Rust daemon reporting:
  - Reviewed `chronicle/src/cradle_client.rs` raw segment transport structs and `record_audio_raw_segment()`.
  - Reviewed `chronicle/src/daemon.rs` raw segment flow. The daemon writes local WAV/metadata first, then best-effort posts `/chronicle/audio-raw-segments`; on POST failure it logs and keeps local artifacts.
  - The payload explicitly sets `vad_implemented`, `asr_implemented`, and `speaker_labeling_implemented` to `false`.

- Server API behavior:
  - Reviewed routes in `apps/server/src/modules/chronicle/index.ts`: `GET /chronicle/audio-raw-segments` and `POST /chronicle/audio-raw-segments` are present.
  - Reviewed service behavior in `apps/server/src/modules/chronicle/service.ts`: list, upsert by `sourceId`, status totals/last timestamp, storage-root-relative path normalization, RMS/peak bps conversion, duration estimation, and event recording are implemented.
  - Timestamp validation rejects obvious invalid strings such as `not-a-date`, but has the whitespace/numeric fallback gap noted above.

- Web Settings:
  - Reviewed `apps/web/src/features/chronicle/use-chronicle.ts`: `useChronicleAudioRawSegments()` fetches `/chronicle/audio-raw-segments`, normalizes raw segment evidence, and preserves VAD/ASR/speaker statuses.
  - Reviewed `apps/web/src/features/chronicle/chronicle-settings.tsx`: Settings renders an "Audio Segments" section with microphone/system/mixed source labels, paths, RMS/peak, duration, and VAD/ASR/Speaker status badges.
  - The UI wording says raw segments are captured before VAD/ASR/speaker processing and does not claim those runtimes are complete.

- Tests:
  - Reviewed `apps/server/tests/chronicle.test.ts`.
  - Covered: POST raw segment, path normalization from absolute storage root to relative path, duration estimation, bps round-trip for RMS/peak, status flags as `not-implemented`, same-source upsert, GET listing, status totals/last timestamp, and obvious invalid timestamp rejection.
  - Missing: whitespace timestamp rejection and daemon reporting failure retention test.

## Residual Risk

- Raw segment rows currently trust daemon-provided local paths after storage-root normalization; paths outside `storageRoot` remain as submitted rather than being rejected. This matches nearby Chronicle artifact behavior, but it means the API stores external absolute paths if a producer sends them.
- `audioRuntimeStatus: "armed"` only proves the daemon was launched with audio capture options; it does not prove a microphone device is available or that a segment has been successfully produced.
- Raw segment DB evidence is intentionally not transcript or memory evidence. Future VAD/ASR/speaker slices must keep the current status names honest and avoid flipping to `ready` until actual runtime processing exists.
