# Build Cradle Chronicle

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements from `/Users/wibus/.agents/skills/execplan/references/PLANS.md`. It is self-contained so another contributor can resume the work with only this file and the repository checkout.

## Purpose / Big Picture

Cradle needs its own Chronicle subsystem based on `docs/draft-solutions/codex-chronicle-spec.md`. Chronicle is a passive context pipeline: it captures observed frames, extracts text, writes durable local artifacts, and periodically turns those artifacts into non-directive memory summaries that future agents can read. This first Cradle version should live in `chronicle/`, use Rust, and be generic enough that real macOS ScreenCaptureKit, Windows, Linux, browser, or plugin sources can be added behind stable traits later.

After this change, a developer can run a local smoke command that writes a synthetic Chronicle segment into a storage root, including `capture.json`, `ocr.json`, `snapshot.json`, and a Markdown memory file. The Rust test suite proves privacy filtering, fingerprint deduplication, artifact layout, memory naming, prompt injection guard text, and the smoke path.

## Progress

- [x] (2026-05-18T17:36:31Z) Read `docs/draft-solutions/codex-chronicle-spec.md`, confirmed the source spec covers capture, privacy filtering, artifact layout, recursive summarization, prompt safety, and `codex exec` isolation.
- [x] (2026-05-18T17:36:31Z) Confirmed the repository has no existing Rust workspace or `chronicle/` directory, so this work creates an independent Rust crate under `chronicle/`.
- [x] (2026-05-18T17:46:12Z) Created the `chronicle/` crate with `chronicle/src/lib.rs` library exports and `chronicle/src/main.rs` binary entry point.
- [x] (2026-05-18T17:49:52Z) Implemented generic capture, OCR, artifact, fingerprint, privacy, recursive summary, local summary, and child-process boundaries.
- [x] (2026-05-18T17:50:58Z) Added unit tests and a binary smoke integration test under `chronicle/tests/smoke.rs`.
- [x] (2026-05-18T17:54:18Z) Ran formatting, tests, clippy, and smoke validation. `cargo test --manifest-path chronicle/Cargo.toml` passed with 20 unit tests and 1 integration smoke test. `cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings` passed. The final smoke command wrote three frame artifacts and one `10min` memory file under `/tmp/cradle-chronicle-smoke-audit-20260518-1753`.
- [x] (2026-05-18T17:56:00Z) Audited implementation against the user request and this plan, including real file output, test coverage, crate placement, Rust quality gates, and documentation updates.

## Surprises & Discoveries

- Observation: The repository currently has a very dirty working tree with many unrelated frontend/server/plugin changes.
  Evidence: `git status --short` showed many modified and untracked files before this plan was created. Chronicle work must avoid reverting or editing unrelated paths.
- Observation: No root `Cargo.toml`, `Cargo.lock`, or `chronicle/` directory existed before this work.
  Evidence: `find . -maxdepth 3 -name Cargo.toml -print` and `find . -maxdepth 3 -iname '*chronicle*'` only found the draft spec.
- Observation: Clippy caught an inefficient manual membership check in the privacy filter.
  Evidence: `cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings` initially failed with `clippy::manual_contains` in `chronicle/src/screen/privacy_filter.rs`; the implementation now uses `self.chrome_bundles.contains(&bundle)`.
- Observation: The first synthetic smoke implementation used fixed frame timestamps while the segment directory used the current time.
  Evidence: An audit read of `capture.json` showed mismatched `segment_started_at` and `captured_at` values. The CLI now uses `SyntheticCaptureSource::cradle_smoke_from(..., segment_started_at)` so smoke frame timestamps advance from the segment start.

## Decision Log

- Decision: Create `chronicle/` as a standalone Rust crate instead of adding a root Cargo workspace.
  Rationale: The repository is primarily TypeScript today and has no Rust workspace. A standalone crate keeps the new subsystem isolated, reviewable, and runnable without changing package manager behavior for the rest of Cradle.
  Date/Author: 2026-05-18 / Codex.
- Decision: Implement platform and LLM integrations behind traits, with a production-neutral synthetic source for tests and smoke.
  Rationale: The draft spec is macOS/Codex-specific, but the user asked for a Cradle-owned design that can support more future capabilities. Traits preserve the artifact and summary contracts while allowing ScreenCaptureKit, plugin feeds, browser snapshots, or external OCR to be added later.
  Date/Author: 2026-05-18 / Codex.
- Decision: Avoid external Rust dependencies in the first crate.
  Rationale: Network access is restricted and the repo has no Rust lockfile. A `std`-only crate allows deterministic local testing now; dependencies such as `tokio`, `serde`, `tracing`, and platform bindings can be introduced later when the workspace policy is settled.
  Date/Author: 2026-05-18 / Codex.
- Decision: Persist per-frame `capture-XXXXX.json` and `ocr-XXXXX.json` files while also writing `capture.json` and `ocr.json` as latest-frame aliases.
  Rationale: The draft spec names `capture.json` and `ocr.json`, but a multi-frame segment would otherwise overwrite earlier metadata and weaken local citations. Per-frame files preserve evidence; latest aliases keep the simple consumer contract.
  Date/Author: 2026-05-18 / Codex.
- Decision: Use `.jpg` frame names in the artifact contract even though synthetic smoke bytes are text-backed.
  Rationale: The source spec uses `frame-XXXXX.jpg`, and future real capture implementations should not need to rename the storage contract. Synthetic smoke only proves the pipeline and does not claim image decoding fidelity.
  Date/Author: 2026-05-18 / Codex.

## Outcomes & Retrospective

The first Cradle Chronicle implementation now exists under `chronicle/` as a standalone Rust crate. It provides a library, CLI binary, capture source trait, synthetic source, OCR trait, privacy filter, frame fingerprinting, artifact store, recorder manager, memory naming, anti-injection prompt builder, recursive `10min` and `6h` summary orchestration, deterministic local summary writer, and child-process execution boundary.

The implementation is intentionally not a native screen recorder yet. It is a working and tested Cradle-owned pipeline with a synthetic smoke source. This keeps the Rust quality bar and storage/memory contracts stable before adding platform-specific ScreenCaptureKit, Windows, Linux, browser, or plugin capture providers.

## Context and Orientation

The source specification is `docs/draft-solutions/codex-chronicle-spec.md`. It describes Codex Chronicle as a Rust binary that captures screen frames, filters privacy-sensitive windows, OCRs text, stores per-frame artifacts, deduplicates repeated frames, and writes recursive memory summaries through an isolated `codex exec` child process.

Cradle does not currently contain a Rust workspace. The new crate will be located at `chronicle/`. Its library entry point will be `chronicle/src/lib.rs`, and its CLI entry point will be `chronicle/src/main.rs`. The CLI will support a synthetic smoke mode so the pipeline can be validated without platform screen permissions or LLM credentials.

A "capture source" means anything that can provide observed frames. In the first version this is `SyntheticCaptureSource`, which returns deterministic test frames. Later implementations can read from macOS ScreenCaptureKit, browser automation, terminal snapshots, or plugin event streams. An "artifact" means a durable file written under the storage root. A "memory" means a Markdown summary derived from observed artifacts and written under `memories/`.

## Plan of Work

Create `chronicle/Cargo.toml`, `chronicle/README.md`, `chronicle/src/lib.rs`, and modules under `chronicle/src/`. The crate exposes stable types and traits for configuration, capture, OCR, artifacts, deduplication, privacy filtering, summarization, and child process execution.

Implement `ChronicleConfig` in `chronicle/src/config.rs`. It resolves a storage root from `--storage-root`, `STORAGE_ROOT`, or a default under the current directory. It stores sampling knobs such as capture limit, display id, and summary window.

Implement error handling in `chronicle/src/error.rs` with a small `ChronicleError` enum and `ChronicleResult<T>` alias. This avoids adding dependencies while keeping error messages explicit.

Implement capture abstractions in `chronicle/src/screen/mod.rs` and `chronicle/src/screen/synthetic.rs`. A `CaptureSource` returns `CapturedFrame` values containing display id, frame index, bytes, observed text, and window metadata. Synthetic mode emits text-backed frames so smoke tests can prove the whole pipeline.

Implement privacy filtering in `chronicle/src/screen/privacy_filter.rs`. It excludes Chrome incognito, Safari private browsing, Safari Technology Preview private windows, and Google Meet windows based on bundle id and title, matching the draft spec while staying platform-neutral.

Implement frame fingerprinting in `chronicle/src/recorder/fingerprint.rs` with a deterministic FNV-style content hash and similarity check for adjacent frames.

Implement artifacts in `chronicle/src/recorder/artifacts.rs`. `ArtifactStore::persist_frame` creates `{storage_root}/{display_id}/{timestamp}/frame-00001.jpg`, per-frame `ocr-00001.json` and `capture-00001.json`, latest-frame aliases `ocr.json` and `capture.json`, and `snapshot.json`. JSON is written by explicit escaping helpers so the crate remains dependency-free.

Implement pipeline orchestration in `chronicle/src/recorder/manager.rs`. `RecorderManager` pulls frames from a source, applies privacy filtering, deduplicates repeated frames, extracts text, and persists artifacts.

Implement memory generation modules under `chronicle/src/memory_pipeline/`. `naming.rs` creates deterministic Chronicle names shaped like `<timestamp>-<4chars>-<window>-<slug>.md`. `prompt.rs` builds a prompt with anti-prompt-injection guardrails. `recursive.rs` orchestrates `10min` and `6h` summary windows. `summarizer.rs` offers a local deterministic summarizer for smoke tests and a trait boundary for future LLM-backed summarizers.

Implement `chronicle/src/codex_exec.rs` as a child-process boundary that can spawn a configured command with prompt stdin and timeout. The first smoke path will not require `codex`; this module exists to preserve the architecture boundary from the spec.

Add tests next to each module and an integration smoke test in `chronicle/tests/smoke.rs`. The smoke test runs the binary with `--smoke --storage-root <temp>` and verifies artifact and memory files exist.

Update `docs/exec-plans/README.md` with the new plan entry.

## Concrete Steps

From `/Users/wibus/dev/Cradle`, create files under `chronicle/` and this ExecPlan. Then run:

    cargo fmt --manifest-path chronicle/Cargo.toml
    cargo test --manifest-path chronicle/Cargo.toml
    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke

Expected successful smoke output includes a line similar to:

    cradle chronicle smoke completed

The storage root should contain a display folder, one timestamped segment folder, and `memories/*.md`.

Final observed validation from this implementation:

    cargo test --manifest-path chronicle/Cargo.toml
    result: 20 unit tests passed, 1 integration smoke test passed, 0 failed.

    cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
    result: finished successfully with no warnings.

    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke-audit-20260518-1753 --capture-limit 3
    result: cradle chronicle smoke completed: observed=3 persisted=3 duplicates=0 privacy_filtered=0 memory=/tmp/cradle-chronicle-smoke-audit-20260518-1753/memories/20260518175418-ccxi-10min-cradle_chronicle_smoke.md

## Validation and Acceptance

Acceptance requires all of the following:

The crate exists under `chronicle/` and builds with `cargo test --manifest-path chronicle/Cargo.toml`.

The smoke command writes at least one persisted frame artifact, `ocr.json`, `capture.json`, `snapshot.json`, and a memory Markdown file under `memories/`.

The tests cover privacy filtering, fingerprint deduplication, artifact JSON content, naming behavior, prompt guardrails, local summarization, child-process execution, and the binary smoke path.

The implementation remains Cradle-owned and generic. No module should hard-code Codex-only storage namespaces as the owner of Cradle data. Codex-compatible behavior may exist at boundaries, especially `codex_exec`, but Cradle owns the `chronicle/` crate and storage layout.

## Idempotence and Recovery

All implementation steps are additive. Re-running `cargo test` or the smoke command is safe. For smoke runs, choose a fresh temporary storage directory or delete the temporary directory manually after inspection. The implementation must not modify unrelated repository files or write outside the requested storage root during normal operation.

If a test fails, inspect the failing module and rerun only the crate tests. No database migration, network operation, or destructive Git command is involved.

## Artifacts and Notes

The final smoke run wrote these files:

    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/capture-00001.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/capture-00002.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/capture-00003.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/capture.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/frame-00001.jpg
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/frame-00002.jpg
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/frame-00003.jpg
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/ocr-00001.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/ocr-00002.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/ocr-00003.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/ocr.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/1/2026-05-18T17-54-16Z/snapshot.json
    /tmp/cradle-chronicle-smoke-audit-20260518-1753/memories/20260518175418-ccxi-10min-cradle_chronicle_smoke.md

The final `capture.json` latest-frame alias contained `display_id`, `segment_started_at`, `captured_at`, `frame_index`, `persisted_frame_path`, and `normalized_text`. The final memory Markdown contained `## Memory summary`, `## Recording summary`, `## Local citations`, and `[chronicle memory]` tags.

## Interfaces and Dependencies

The crate should expose these stable interfaces from `chronicle/src/lib.rs`:

    pub use config::ChronicleConfig;
    pub use error::{ChronicleError, ChronicleResult};
    pub use recorder::manager::{RecorderManager, RecorderReport};

In `chronicle/src/screen/mod.rs`, define:

    pub trait CaptureSource {
        fn next_frame(&mut self) -> ChronicleResult<Option<CapturedFrame>>;
    }

In `chronicle/src/ocr.rs`, define:

    pub trait TextExtractor {
        fn extract_text(&self, frame: &CapturedFrame) -> ChronicleResult<OcrText>;
    }

In `chronicle/src/memory_pipeline/summarizer.rs`, define:

    pub trait SummaryWriter {
        fn write_summary(&self, request: SummaryRequest) -> ChronicleResult<MemorySummary>;
    }

In `chronicle/src/codex_exec.rs`, define a child process runner that accepts an executable path, args, stdin text, and timeout. It should be tested with a local command that does not require network or LLM credentials.

Revision note 2026-05-18: Initial plan created after reading the draft spec and confirming no existing Rust or Chronicle implementation exists in the repository.

Revision note 2026-05-18: Updated after implementation with completed progress, artifact contract details, validation transcripts, and retrospective notes.
