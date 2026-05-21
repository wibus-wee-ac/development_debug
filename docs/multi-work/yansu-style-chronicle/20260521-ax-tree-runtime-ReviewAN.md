# AX Tree Runtime Review

## Conclusion

No blocking issues found. The AX polling path moves Chronicle from window inventory evidence toward real macOS Accessibility tree capture while keeping the existing Chronicle evidence contract.

## Findings

- Medium: AX polling ran before the privacy filter. Private windows would not be persisted, but AX tree data could still be read into memory. The capture path should run privacy filtering before any AX polling.
- Low: `AXUIElementCopyAttributeValue` failure handling did not release a non-null value if the API returned an error while writing a value.
- Low: Nodes at maximum depth still attempted to copy `AXChildren` / `AXContents` before recursive depth checks rejected the children.
- Low: Server tests covered generic `ready` and `permission-denied` evidence but not the `macos-ax-tree-poll` provider.

## Suggested Validation

```bash
cargo fmt --manifest-path chronicle/Cargo.toml -- --check
cargo clippy --manifest-path chronicle/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path chronicle/Cargo.toml --lib
pnpm --filter @cradle/server exec vitest run tests/chronicle.test.ts
pnpm --filter @cradle/web exec eslint src/features/chronicle/chronicle-settings.tsx
git diff --check -- chronicle/src/screen/macos.rs chronicle/src/screen/mod.rs chronicle/src/recorder/artifacts.rs chronicle/src/cradle_client.rs apps/server/tests/chronicle.test.ts apps/web/src/features/chronicle/chronicle-settings.tsx
```
