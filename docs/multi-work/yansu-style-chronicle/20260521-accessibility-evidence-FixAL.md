# Accessibility Evidence Fix

## Fixes

- Changed macOS `AXIsProcessTrusted()` FFI return type from Rust `bool` to `c_uchar` and converted it with `!= 0`.
- Added Server test coverage for `permission-denied` accessibility evidence ingested through `POST /chronicle/snapshots`.
- Updated the Accessibility status count to use Drizzle `count()` instead of adding another raw SQL count.
- Ran Rust formatting after the FFI change.

## Validation

Passed:

```bash
pnpm --filter @cradle/server exec tsc --noEmit
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/use-chronicle.ts src/features/chronicle/chronicle-settings.tsx
pnpm exec drizzle-kit generate --config drizzle.config.ts
cargo test --manifest-path chronicle/Cargo.toml --lib
git diff --check
```

Drizzle result:

```text
No schema changes, nothing to migrate
```
