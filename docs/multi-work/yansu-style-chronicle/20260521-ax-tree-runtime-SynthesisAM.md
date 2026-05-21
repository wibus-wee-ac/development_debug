# AX Tree Runtime Synthesis

## Scope

This slice upgrades Chronicle accessibility capture from window inventory evidence to best-effort macOS AX tree polling. It reuses the existing Chronicle-owned accessibility evidence table and API contract; no database migration is required.

## Behavior

- Rust checks macOS Accessibility permission before AX work.
- If permission is missing, snapshot accessibility evidence remains `permission-denied`.
- If permission is granted, Rust tries to read the frontmost application's focused window, main window, or focused UI element.
- Rust recursively polls `AXChildren` and `AXContents` through `AXUIElementCopyAttributeValue`.
- Captured nodes include:
  - `role`
  - `label`
  - `value`
  - `appBundleId`
  - `windowId`
  - `depth`
  - `path`
- Successful AX tree polling uses provider `macos-ax-tree-poll`.
- If AX tree polling cannot produce nodes, Rust falls back to `macos-accessibility-window-inventory`.
- Server keeps writing the payload into `chronicle_accessibility_snapshots.treeJson`.
- Web Settings now previews the first few AX tree nodes in each accessibility evidence card.

## Non-Goals

- This is not the AXObserver notification lifecycle.
- This does not subscribe to `kAXFocusedUIElementChangedNotification` or `kAXWindowCreatedNotification`.
- This does not change the database schema.

## Validation

Passed:

```bash
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
pnpm exec drizzle-kit generate --config drizzle.config.ts
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo test --manifest-path chronicle/Cargo.toml --lib
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
```

Drizzle result:

```text
No schema changes, nothing to migrate
```

## Remaining Gaps

- AXObserver event subscription and app/window lifecycle management.
- Better mapping from AX tree nodes to the matching captured CGWindow id.
- Permission diagnostics surfaced outside the accessibility evidence list.
