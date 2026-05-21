# AXObserver Lifecycle Fix BE

## Scope

Applied fixes after `20260521-axobserver-lifecycle-ReReviewBD.md`.

## Fixes

- Subscription ready contract:
  - `AXObserverAddNotification` results are now counted.
  - Runtime startup fails if no notification subscription succeeds.
  - Startup timeout returns unavailable instead of returning a usable runtime handle.
- Lifecycle target handling:
  - frontmost application lookup failure now counts as target changed, so stale observers do not remain trusted.
- Backpressure:
  - pending events are scanned in a bounded window and coalesced by `pid + bundle + notification` during drain before any expensive capture is triggered.
  - bounded queue and dropped-event count remain in place.
- Startup timeout:
  - timeout now returns unavailable and sends a stop command to the worker channel before returning.
- Run loop binding:
  - the worker uses the CoreFoundation `kCFRunLoopDefaultMode` symbol instead of a hand-written string value.
- Privacy/documentation:
  - documentation no longer claims redacted AXObserver evidence is guaranteed to persist for private windows.
  - private-window event handling is described as suppressing event-triggered capture before AX tree expansion.
  - README wording now calls this an AXObserver foundation, not a standalone mature AX event history pipeline.

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo check --manifest-path chronicle/Cargo.toml
cargo test --manifest-path chronicle/Cargo.toml --lib
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
git diff --check
```

## Remaining Boundary

AXObserver notification-triggered evidence still rides through the existing screenshot/OCR/snapshot contract. A future slice can split standalone AX notification persistence if the product needs UI event history independent from captured frames.
