# Yansu-Style Chronicle Rust Transcript Inbox Fix

## Scope

This fix responds to `20260521-rust-transcript-inbox-ReviewS.md`.

## Fixed Findings

### Bounded daemon inbox work

Review finding:

- Daemon loop could retry the full failed transcript backlog before every screen capture.

Fix:

- Added `process_transcript_inbox_tick()` in `chronicle/src/transcript_inbox.rs`.
- The tick path uses a small per-loop batch limit.
- `chronicle/src/daemon.rs` now calls `process_transcript_inbox_tick()` instead of the unbounded full scan.
- The full `process_transcript_inbox()` remains available for explicit full processing and tests.

Test coverage:

- `limits_failed_manifest_work_per_tick` verifies a failed inbox can be bounded to two manifests while all source files remain available for retry.

### Server-equivalent manifest defaults

Review finding:

- Rust manifest deserialization required fields that Server `/chronicle/audio-transcripts` treats as optional/defaulted.

Fix:

- `ChronicleAudioTranscriptReport` now has a custom `Deserialize` implementation.
- Missing `source` defaults to `imported`.
- Missing `status` defaults to `completed` for ASR and `imported` otherwise.
- Missing top-level `metadata` and segment `metadata` default to `{}`.
- Optional nullable fields now deserialize with `#[serde(default)]`.

Test coverage:

- `applies_server_defaults_before_reporting_manifest` omits `source`, `status`, top-level `metadata`, and segment `metadata`, then verifies the posted body contains Server-equivalent defaults.

### Server rejection and error preservation

Review finding:

- Tests covered unreachable transport failure but not a reachable Server returning rejection or error status.

Fix:

- Extended the local test HTTP server to return configurable status codes.
- Added status-code rejection coverage.
- Improved test HTTP request reading by parsing `Content-Length` case-insensitively.

Test coverage:

- `keeps_manifest_when_server_rejects_report` verifies a `400` response preserves the source manifest and does not create a processed copy.
- `keeps_manifest_when_server_errors_report` verifies a `500` response preserves the source manifest and does not create a processed copy.

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

Current Rust result:

- 47 unit tests passed.
- 1 smoke test passed.
- clippy passed with warnings denied.

## Files Changed

- `chronicle/src/cradle_client.rs`
- `chronicle/src/transcript_inbox.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/README.md`
- `docs/exec-plans/20260521-03-yansu-style-chronicle.md`
- `docs/multi-work/yansu-style-chronicle/20260521-rust-transcript-inbox-SynthesisR.md`
