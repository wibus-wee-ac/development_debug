# Raw Audio Segment Evidence Synthesis

## Scope

This slice turns existing Rust microphone segment artifacts into Chronicle-owned evidence that Server and Web can see. It does not implement VAD, ASR, speaker labeling, system audio capture, transcript generation, or memory generation from raw audio.

The behavior target is:

- Rust daemon writes local microphone segment WAV/metadata artifacts first.
- Rust daemon best-effort reports the artifact metadata to Cradle Server.
- Server stores raw audio evidence in DB using the Chronicle namespace.
- Web Settings shows recent raw audio evidence without implying downstream processing is complete.
- Database changes remain Drizzle schema-first.

## Implementation Summary

### Database

`packages/db/src/schema/chronicle.ts` defines `chronicleAudioRawSegments`.

The table stores:

- `sourceId` for idempotent upsert.
- `workspaceId` and `recordedAt`.
- `source`: `microphone | system | mixed`.
- `status`: `captured | queued | processed | ignored | error`.
- `audioPath` and `metadataPath`.
- sample stats: `sampleRate`, `channels`, `sampleCount`, `droppedSamples`, `durationMs`.
- activity scores: `rmsBps`, `peakBps`, `active`.
- downstream processing state: `vadStatus`, `asrStatus`, `speakerStatus`.
- `metadataJson`.

Migration artifact:

- `packages/db/drizzle/0028_chief_clea.sql`
- `packages/db/drizzle/meta/0028_snapshot.json`

Validation command:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

Observed result:

```text
No schema changes, nothing to migrate
```

No hand-written SQL was edited for this slice.

### Server

Changed files:

- `apps/server/src/modules/chronicle/index.ts`
- `apps/server/src/modules/chronicle/model.ts`
- `apps/server/src/modules/chronicle/service.ts`
- `apps/server/tests/chronicle.test.ts`

New routes:

- `GET /chronicle/audio-raw-segments`
- `POST /chronicle/audio-raw-segments`

Server behavior:

- Validates `recordedAt` through the same explicit timestamp path as transcript ingest.
- Normalizes artifact paths relative to Chronicle `storageRoot`.
- Estimates `durationMs` from `sampleCount / sampleRate` when omitted.
- Stores `rms` and `peak` as basis points, returning normalized ratios to clients.
- Upserts by `sourceId`, avoiding duplicate rows for the same raw segment.
- Sets `vadStatus`, `asrStatus`, and `speakerStatus` to `pending` only when the report says that runtime is implemented; otherwise they remain `not-implemented`.
- Adds `totalAudioRawSegments` and `lastAudioRawSegmentAt` to `/chronicle/status`.
- Records a Chronicle `audio` event after ingest.

Server test coverage now asserts:

- `POST /chronicle/audio-raw-segments` returns 200.
- absolute paths under `storageRoot` are returned as relative paths.
- `durationMs` is estimated when omitted.
- `rms` and `peak` round-trip through basis-point storage.
- duplicate `sourceId` updates the existing row.
- `GET /chronicle/audio-raw-segments` returns the newest row.
- `/chronicle/status` includes raw audio segment count and last timestamp.
- invalid `recordedAt` returns 400.

### Rust

Changed files:

- `chronicle/src/cradle_client.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/README.md`

Rust behavior:

- `ChronicleAudioRawSegmentReport` defines the Server payload.
- `ChronicleAudioRawSegmentSource` and `ChronicleAudioRawSegmentStatus` serialize to the Server enum strings.
- `CradleClient::record_audio_raw_segment()` validates the payload then posts to `/chronicle/audio-raw-segments`.
- `daemon.rs` writes the microphone segment artifact first, then calls `record_audio_raw_segment()` best-effort.
- Report failure logs an error and keeps local WAV/JSON artifacts.
- `sourceId` is derived from the metadata file stem as `audio:microphone:<stem>`.

Rust tests now assert:

- raw audio segment reports serialize with camelCase keys.
- source/status enum values serialize as `microphone` and `captured`.
- validation rejects empty paths, zero sample rate, invalid RMS, and invalid peak.

### Web

Changed files:

- `apps/web/src/features/chronicle/use-chronicle.ts`
- `apps/web/src/features/chronicle/chronicle-settings.tsx`
- `apps/web/src/features/chronicle/README.md`

Web behavior:

- `ChronicleStatus` includes raw audio segment count and last timestamp.
- `ChronicleAudioRawSegment` models the response shape.
- `useChronicleAudioRawSegments()` polls `/chronicle/audio-raw-segments`.
- Manual refresh invalidates the raw segment query.
- Status panel shows raw segment count and recent time.
- A new Audio Segments section lists:
  - recorded time
  - active/quiet state
  - duration
  - RMS/peak
  - sample rate/channels
  - artifact paths
  - VAD/ASR/Speaker processing status

The UI text stays scoped to evidence and status. It does not claim VAD, ASR, speaker labeling, transcript generation, memory generation, or system audio are ready.

## Validation Run

Commands run successfully:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo test --manifest-path chronicle/Cargo.toml cradle_client --lib
```

Focused Rust `cargo check --manifest-path chronicle/Cargo.toml` also passed after wiring daemon reporting.

## Known Non-Goals

Still not implemented:

- System audio capture.
- Silero VAD runtime.
- SenseVoice/Sherpa ASR runtime.
- Speaker embedding or diarization runtime.
- Transcript artifact writer from raw audio.
- Memory derivation from raw audio.
- ONNX text embedding inference beyond the existing lexical vector foundation.

## Residual Risk

The raw segment table can become the queue boundary for later VAD/ASR/speaker workers, but this slice does not add job leasing, retries, or processing worker ownership. Later runtime slices should decide whether to reuse `status` and processing status columns directly or add a separate processing job table if concurrency and resumability require it.

The Web UI currently displays file paths as evidence strings. It does not expose playback or artifact download. That is acceptable for this slice because the immediate unblock is visibility and durable registration, not media review.
