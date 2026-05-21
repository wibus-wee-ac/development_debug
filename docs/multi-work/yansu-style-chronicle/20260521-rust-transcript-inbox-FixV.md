# Yansu-Style Chronicle Rust Transcript Inbox Second Fix

## Scope

This fix responds to `20260521-rust-transcript-inbox-ReReviewU.md`.

## Fixed Finding

### Explicit 500 preservation coverage

Re-review finding:

- `400` Server rejection preservation was covered, but explicit `500` Server error preservation was missing.

Fix:

- Added `keeps_manifest_when_server_errors_report` in `chronicle/src/transcript_inbox.rs`.
- The test starts the local HTTP test server with status `500`.
- It verifies the report is counted as failed, the original manifest remains in `audio-transcripts/`, and no `processed/meeting.json` is created.

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
