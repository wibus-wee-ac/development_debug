# Yansu-Style Chronicle Rust Transcript Inbox Synthesis

## Scope

This slice adds a recoverable Rust-side inbox for audio transcript manifests produced by a future local ASR runtime, fixture importer, or external transcript producer.

It does not implement microphone capture, system audio capture, VAD, ASR, speaker labeling, transcript artifact generation, or model inference. It consumes already-produced transcript JSON and reports it to the existing Server contract.

## Implemented Artifacts

### Rust

Files touched:

- `chronicle/src/transcript_inbox.rs`
- `chronicle/src/cradle_client.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/lib.rs`
- `chronicle/src/README.md`

New module:

- `transcript_inbox`

`process_transcript_inbox()` behavior:

1. Scans `CHRONICLE_INBOX_ROOT/audio-transcripts/*.json`.
2. Ignores non-file and non-JSON entries.
3. Reads each manifest with a 10 MB body limit.
4. Deserializes into `ChronicleAudioTranscriptReport`.
5. Runs local report validation before posting.
6. Calls `CradleClient::record_audio_transcript()`.
7. Moves successful manifests to `CHRONICLE_INBOX_ROOT/audio-transcripts/processed/`.
8. Leaves failed manifests in place for retry.
9. Returns scanned, reported, and failed counts.

`process_transcript_inbox_tick()` is the daemon-facing bounded variant. It processes a small batch per loop so a backlog of invalid or unreachable transcript manifests cannot repeatedly block the full screen capture cadence.

Daemon integration:

- `--run-once` processes transcript manifests once after capture and before snapshot reporting.
- Long-running daemon loop processes a bounded transcript manifest batch once per loop before screen capture and idle handling.
- Inbox errors are logged and do not block screen capture or local artifact persistence.

The Rust client structs now deserialize manifests with the same optional/default semantics as Server ingest. Missing `source` defaults to `imported`, missing `status` defaults to `completed` for ASR and `imported` otherwise, and missing metadata objects default to `{}`. `ChronicleTranscriptConfidence` keeps bounded deserialization through its custom `Deserialize` implementation.

### Documentation

`chronicle/src/README.md` now lists `transcript_inbox.rs` and documents:

- input path: `CHRONICLE_INBOX_ROOT/audio-transcripts/*.json`;
- success path: `CHRONICLE_INBOX_ROOT/audio-transcripts/processed/`;
- failed-post behavior: original manifest remains for retry;
- runtime boundary: this is not audio capture, VAD, ASR, or speaker labeling.

The ExecPlan was updated with progress, observation, decision, validation, and revision notes for the transcript inbox.

## Contract Example

```json
{
  "sourceId": "meeting-source-1",
  "title": "Chronicle transcript",
  "source": "imported",
  "status": "completed",
  "startedAt": "2026-05-21T10:30:00Z",
  "endedAt": "2026-05-21T10:40:00Z",
  "language": "en",
  "segments": [
    {
      "startMs": 0,
      "endMs": 2500,
      "speakerLabel": "Ada",
      "text": "Inbox transcript target",
      "confidence": 0.94,
      "language": "en",
      "metadata": {}
    }
  ],
  "metadata": {
    "runtime": "fixture"
  }
}
```

On successful Server ingest:

```text
CHRONICLE_INBOX_ROOT/audio-transcripts/processed/meeting.json
```

On failed parse, validation, or post:

```text
CHRONICLE_INBOX_ROOT/audio-transcripts/meeting.json
```

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

The Rust tests prove:

- a valid manifest is posted to a local HTTP test server;
- a successful manifest moves to `processed/`;
- the posted body contains the expected Server contract JSON;
- missing optional Server fields are filled with Server-equivalent defaults before posting;
- unreachable transport leaves the original manifest in place;
- reachable Server 400 rejection leaves the original manifest in place;
- reachable Server 500 error leaves the original manifest in place;
- failed manifest work can be bounded per tick;
- failure counts are returned without aborting the whole inbox scan.

## Drizzle Note

This slice does not change database schema.

The active branch already contains Chronicle DB migrations through Drizzle Kit:

- `0025_lowly_stature`
- `0026_perfect_korath`
- `0027_dazzling_vance_astro`

Before this handoff, the migration chain was rechecked with:

```bash
pnpm exec drizzle-kit generate --config drizzle.config.ts
```

The command returned `No schema changes, nothing to migrate`, confirming that the current `packages/db/src/schema/chronicle.ts` and Drizzle snapshots/journal are aligned.

## Known Limitations

- No real local audio runtime exists yet.
- The inbox does not deduplicate files beyond Server-side `sourceId` semantics.
- `fs::rename()` can fail across filesystems, though both source and `processed/` are under the same transcript inbox directory in the intended layout.
- A malformed manifest is retried every loop until removed or fixed.
- There is no quarantine directory yet for permanently invalid manifests.

## Review Focus

Reviewers should check:

- whether failed manifests are preserved in all non-success paths;
- whether successful manifests move only after Server post success;
- whether the Rust JSON contract still matches Server `/chronicle/audio-transcripts`;
- whether daemon integration can block or degrade screen capture;
- whether docs avoid claiming implemented audio capture, VAD, ASR, or speaker labeling.
