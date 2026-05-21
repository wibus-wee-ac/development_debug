# Rust Transcript Inbox Re-Review

## Verdict

Requires fixes.

## Findings

- No remaining finding for daemon/inbox bounded processing. `chronicle/src/daemon.rs:96` still calls transcript processing before capture, but the call now routes through `process_transcript_inbox_tick()` at `chronicle/src/daemon.rs:307`, and that tick path is capped by `DEFAULT_TRANSCRIPT_INBOX_BATCH_LIMIT` at `chronicle/src/transcript_inbox.rs:9` and `.take(max_manifests)` at `chronicle/src/transcript_inbox.rs:60`. A failed backlog can still delay a loop by the bounded batch, but it no longer retries the entire backlog before every capture.
- No remaining finding for Rust manifest optional/default alignment with Server ingest. `ChronicleAudioTranscriptReport` now deserializes through a raw optional shape at `chronicle/src/cradle_client.rs:187`, defaults missing `source` to `imported` at `chronicle/src/cradle_client.rs:221`, defaults missing `status` through `default_for_source()` at `chronicle/src/cradle_client.rs:222`, and defaults top-level plus segment `metadata` to empty objects at `chronicle/src/cradle_client.rs:164` and `chronicle/src/cradle_client.rs:216`.
- Low: Server rejection preservation coverage is only explicit for `400`, not `500`. `keeps_manifest_when_server_rejects_report` starts a reachable local server returning `400`, processes the manifest, and asserts the original file remains while no processed copy is created at `chronicle/src/transcript_inbox.rs:263`. I did not find an equivalent test using `TestServer::start(500)`, so the requested `400/500` coverage is not fully closed even though both statuses likely exercise the same `ureq` non-2xx error path.

## Validation Notes

- Reviewed `ReviewS`, `FixT`, and `SynthesisR` plus the requested Rust, README, and ExecPlan files.
- Verified bounded behavior is covered by `limits_failed_manifest_work_per_tick`, which creates five failing manifests and asserts only two are scanned while all five JSON files remain in the inbox.
- Verified defaulting coverage is present in `applies_server_defaults_before_reporting_manifest`, which omits `source`, `status`, top-level `metadata`, and segment `metadata`, then checks the posted body contains defaulted values and the successful manifest is moved.
- Verified reachable Server rejection preservation is covered for `400`; explicit `500` preservation coverage is missing.
- I did not run the test suite during this re-review; this pass is based on source inspection against the three requested ReviewS closure points.
