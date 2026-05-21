# AX Tree Runtime Fix

## Fixes

- Moved privacy filtering before `read_accessibility_capture()` so private windows are excluded before any AX polling happens.
- Released a non-null copied AX attribute value even when `AXUIElementCopyAttributeValue` returns a non-success code.
- Avoided copying `AXChildren` and `AXContents` when the current node is already at `AX_MAX_DEPTH`.
- Added Server coverage for a successful `macos-ax-tree-poll` accessibility payload, including preserved tree JSON.

## Validation

Passed:

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo test --manifest-path chronicle/Cargo.toml --lib
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
```
