<!-- Once this directory changes, update this README.md -->

# Features/pack-codebase

Pack-codebase renderer feature — dialog UI for configuring and triggering workspace packing.
Uses `POST /workspaces/:id/pack` and writes the result to the system clipboard.

## Files

- **pack-codebase-dialog-loader.ts**: Pack-codebase dialog 的共享 lazy loader 与 intent preload 入口，供 workspace menu 和 file tree handoff 复用
- **pack-codebase-dialog.tsx**: Full-featured i18n-backed dialog with format selector, compression toggle, accessible scope path input, pattern filters, clipboard copy action, and first-render performance completion mark for the lazy dialog surface.
- **pack-codebase-utils.ts**: Pure helpers for scope path parsing and include glob construction. Token display uses renderer-owned `~/lib/number-format`.
- **pack-codebase-utils.test.ts**: Unit coverage for comma/newline path parsing, deduplication, and include globs
