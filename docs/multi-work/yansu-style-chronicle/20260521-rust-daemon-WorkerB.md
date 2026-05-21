# Worker B Handoff: Rust Daemon Server Reporting

## Scope

Assigned node: implement or prepare the Rust daemon/client slice for reporting snapshots and memories back to Cradle Server while preserving local artifact fallback.

Owned write scope used:

- `chronicle/src/cradle_client.rs`
- `chronicle/src/daemon.rs`
- `chronicle/src/README.md`
- `docs/multi-work/yansu-style-chronicle/20260521-rust-daemon-WorkerB.md`

`chronicle/src/config.rs` was inspected but not changed.

## Implementation

- Added typed Rust report payloads in `chronicle/src/cradle_client.rs`:
  - `ChronicleSnapshotReport`
  - `ChronicleMemoryReport`
- Added `CradleClient::record_snapshot()` and `CradleClient::record_memory()` best-effort HTTP methods.
- Snapshot reports POST to `/api/chronicle/snapshots`.
- Memory reports POST to `/api/chronicle/memories`.
- Added serialization tests for both typed payloads.
- Updated `chronicle/src/daemon.rs` so:
  - `--run-once` reports persisted snapshots after local artifacts are written.
  - daemon loop reports each persisted snapshot batch after capture.
  - LLM summaries are still written locally, then reported as `summaryKind: "llm"`.
  - local fallback summaries are written locally, then reported as `summaryKind: "local"`.
  - report failures only log to stderr and do not delete or skip local artifacts/memories.
- Updated `chronicle/src/README.md` with the Rust-side reporting contract and fallback semantics.

## Integration Notes

The current Server branch inspected by this worker does not yet expose `recordSnapshot` / `recordMemory` routes. Rust is prepared for the expected endpoints:

- `POST /api/chronicle/snapshots`
- `POST /api/chronicle/memories`

Until Worker A or integration work lands those routes, the daemon will log report failures and keep local evidence. This preserves the ExecPlan recovery requirement.

Payload field names are camelCase. Key fields:

- Snapshot: `sourceId`, `displayId`, `frameIndex`, `capturedAt`, `segmentDir`, `framePath`, `capturePath`, `ocrPath`, `snapshotPath`, `ocrText`.
- Memory: `sourceId`, `windowType`, `createdAt`, `memoryPath`, `content`, `summaryKind`, `sourceSnapshotPaths`, `sourceFramePaths`.

## Validation

Passed:

```sh
cargo fmt --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml
```

`cargo test` result: 39 tests passed.

Blocked by pre-existing out-of-scope clippy issue:

```sh
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

Failure:

- `chronicle/src/screen/privacy_filter.rs:75`
- `chronicle/src/screen/privacy_filter.rs:83`
- `chronicle/src/screen/privacy_filter.rs:92`

All three are `clippy::default_constructed_unit_structs` from `PrivacyFilter::default()` in tests. `chronicle/src/screen/privacy_filter.rs` is outside WorkerB write scope, so this worker did not edit it.

## Residual Risk

- Endpoint path and payload shape may need a small alignment pass after the Server worker lands concrete route names and TypeBox schemas.
- There is no retry queue yet. The local artifact and markdown files are retained as recovery source, but this slice only performs immediate best-effort reports.
