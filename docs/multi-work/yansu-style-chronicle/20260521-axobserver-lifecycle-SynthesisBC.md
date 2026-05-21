# AXObserver Lifecycle Synthesis BC

## Scope

Implemented the Rust/macOS AXObserver notification lifecycle foundation for Yansu-style Chronicle.

## Changes

- Added macOS `AxObserverRuntime` in `chronicle/src/screen/macos.rs`.
- The runtime:
  - creates `AXObserver` for the current frontmost application PID
  - subscribes focused element, focused window, window created, value changed, selected text changed, and title changed notifications
  - treats startup as failed when no notification subscription succeeds
  - attaches the observer run loop source to a dedicated worker thread
  - sends callback notifications into a bounded Rust queue
  - coalesces duplicate pending events during drain before triggering captures
  - records dropped-event backpressure count when the queue is full
  - releases AX refs and joins the worker on drop
- Added daemon lifecycle integration in `chronicle/src/daemon.rs`.
- The daemon:
  - starts AXObserver only for the macOS provider and when `ax_observer` is enabled
  - rebuilds the observer when the frontmost application target changes
  - drains a small bounded batch of notifications per daemon loop
  - turns each event into `macos-ax-observer` accessibility evidence
  - reports evidence through the existing snapshot artifact and `/chronicle/snapshots` path
- Added CLI config:
  - `--ax-observer`
  - `--no-ax-observer`
  - `CRADLE_CHRONICLE_NO_AX_OBSERVER`
- Updated Chronicle README files and the Yansu-style exec plan.

## Review Input

This slice consumed the independent review:

- `docs/multi-work/yansu-style-chronicle/20260521-axobserver-lifecycle-ReviewBB.md`

Key review constraints addressed:

- The observer is daemon/runtime-owned, not a renamed polling helper.
- It calls `AXObserverCreate`, `AXObserverAddNotification`, and runs the observer source through a dedicated run loop.
- Callback work is small and uses a bounded queue.
- Daemon shutdown drops the runtime and joins the worker.
- Frontmost app target changes rebuild the subscription.
- Privacy filtering is checked before event-triggered AX tree expansion; sensitive windows suppress event-triggered capture instead of reading titles/values.
- Evidence is visible through Chronicle-owned artifacts and Server ingest.

## Known Boundaries

- AX notification evidence currently rides on the existing snapshot/accessibility contract as provider `macos-ax-observer`; there is not yet a separate DB table for standalone AX notification history.
- Privacy filtering is conservative at current visible-window scope before AX tree expansion. It does not yet keep a per-window AX observer subscription registry that can filter by exact window id before queueing the callback.
- Unsupported notifications are tolerated because macOS apps vary in which AX notifications they expose.
- Event-triggered evidence still uses the existing screenshot/OCR/snapshot persistence path. The drain path coalesces duplicate pending events, but this is not yet a fully standalone low-cost AX event stream.

## Validation

Target validation commands:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo check --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml --lib
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
git diff --check
```

## Remaining Scope

This does not claim full Yansu parity. System audio capture, real VAD/ASR/speaker runtimes, ONNX embeddings, semantic merge thresholds, automatic dream scheduling, and solve-layer integration remain open.
