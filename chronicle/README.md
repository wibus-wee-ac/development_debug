# Cradle Chronicle

Cradle Chronicle is a Rust crate for passive context capture and local memory generation.

This first implementation is intentionally platform-neutral. It provides stable Rust traits for capture sources, OCR text extraction, artifact storage, privacy filtering, frame deduplication, memory prompt construction, local summarization, and child process execution. The default smoke path uses synthetic frames so the full pipeline can be tested without macOS Screen Recording permission or LLM credentials.

## Commands

Run all tests:

    cargo test --manifest-path chronicle/Cargo.toml

Run the smoke pipeline:

    cargo run --manifest-path chronicle/Cargo.toml -- --smoke --storage-root /tmp/cradle-chronicle-smoke

The smoke run writes frame artifacts under `/tmp/cradle-chronicle-smoke/{display_id}/{timestamp}/` and memory files under `/tmp/cradle-chronicle-smoke/memories/`.

## File Inventory

- `Cargo.toml`: Crate metadata for the library and CLI binary.
- `src/lib.rs`: Public library exports.
- `src/main.rs`: Minimal CLI for smoke validation.
- `src/config.rs`: Runtime configuration and CLI/environment parsing.
- `src/error.rs`: Crate error type.
- `src/json.rs`: Minimal JSON escaping helpers used by artifact writers.
- `src/time.rs`: UTC timestamp formatting without external dependencies.
- `src/ocr.rs`: OCR trait and observed-text extractor.
- `src/screen/`: Capture traits, window observations, privacy filtering, and synthetic capture source.
- `src/recorder/`: Artifact storage, fingerprint deduplication, and recorder orchestration.
- `src/memory_pipeline/`: Memory naming, prompt building, and summary writer traits.
- `src/codex_exec.rs`: Child process boundary for future LLM-backed summarization.
- `tests/smoke.rs`: Binary-level smoke test.
