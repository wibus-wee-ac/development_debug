# Rust Transcript Inbox Review

## Verdict

Requires fixes.

## Findings

### Medium: Daemon loop can repeatedly delay screen capture behind failed transcript posts

- Location: `chronicle/src/daemon.rs:96`, `chronicle/src/transcript_inbox.rs:43`, `chronicle/src/cradle_client.rs:350`
- Impact: The long-running daemon calls `process_transcripts()` before idle handling and before each screen capture. `process_transcript_inbox()` then processes every pending manifest synchronously, and each failed Server post can consume the configured HTTP timeout. Because failed manifests intentionally remain in place, a batch of unreachable or permanently invalid manifests can add repeated delay before every capture loop.
- Why this matters: The slice goal says inbox errors should not block screen capture. The current behavior is recoverable for manifest preservation, but it can degrade or effectively starve capture cadence under backlog or Server outage.
- Suggested fix: Put a small per-loop processing budget around transcript inbox work, move it after capture, or run transcript posting on a separate worker with backpressure. Keep failed manifests in place, but avoid retrying the full backlog before capture on every loop.
- Needed test: Add a daemon-level or inbox-level test proving a large/failed inbox is bounded per tick and does not gate the capture path indefinitely.

### Medium: Rust manifest contract is stricter than the Server `/chronicle/audio-transcripts` body contract

- Location: `chronicle/src/cradle_client.rs:154`, `chronicle/src/cradle_client.rs:166`, `apps/server/src/modules/chronicle/model.ts:202`
- Impact: Server accepts `source`, `status`, top-level `metadata`, and segment `metadata` as optional fields, with defaults for `source` and `status`. Rust deserialization requires all of them. A payload that is valid for direct Server ingest can fail in the Rust inbox and be retried forever.
- Why this matters: The synthesis states that manifest JSON uses the same typed transport contract Rust posts to Server. The camelCase names, enum values, timestamp strings, confidence range, and segment range rule line up, but optionality does not.
- Suggested fix: Either make Rust optionality match Server and apply the same defaults before posting, or explicitly document the inbox as a stricter manifest format and add a local error/quarantine strategy for permanently invalid manifests. Matching Server is preferable for a stable handoff contract.
- Needed test: Add a manifest test that omits `source`, `status`, top-level `metadata`, and segment `metadata`, then verifies Rust posts the Server-default-equivalent body successfully.

### Low: Missing tests for Server rejection preservation

- Location: `chronicle/src/transcript_inbox.rs:170`, `chronicle/src/cradle_client.rs:342`
- Impact: Existing failure coverage uses an unreachable port. That proves transport failure preserves the manifest, but it does not prove a reachable Server returning `400` or `500` preserves the manifest.
- Why this matters: `ureq` 3.3.0 defaults `http_status_as_error` to true, so the current implementation should preserve manifests on non-2xx responses. A regression test would lock this behavior down where it matters most.
- Suggested fix: Extend the local HTTP test server to return `400` and assert the manifest stays in `audio-transcripts/`.

## Ownership Review

- The inbox writes only under `CHRONICLE_INBOX_ROOT/audio-transcripts/processed/`, which is a Chronicle-owned ingest namespace. I did not find writes into `.agents`, model resource namespaces, provider profile storage, or any other product-owned namespace.
- Server-side persisted data remains under Chronicle-owned tables and the `/chronicle/audio-transcripts` route. The Rust side reads externally produced manifests but does not take ownership of external producers' lifecycle beyond moving successfully ingested manifests into the Chronicle processed directory.
- The README correctly frames the inbox as a transcript evidence handoff. It does not claim that microphone capture, system audio capture, VAD, ASR, or speaker labeling is implemented.

## Validation Notes

- I reviewed the required plan and synthesis documents plus the requested Rust files.
- Successful movement is correctly ordered after `client.record_audio_transcript(&report)` returns `Ok(())`; parse, local validation, transport failure, and Server HTTP error paths do not call `mark_processed()`.
- `ureq` is locked at `3.3.0`; its default `http_status_as_error` is true, so 4xx/5xx responses are treated as errors unless explicitly disabled.
- The current Rust tests cover successful post and unreachable transport failure. They do not cover Server rejection, optional Server fields, daemon capture non-blocking behavior, or processed-file collision behavior.
