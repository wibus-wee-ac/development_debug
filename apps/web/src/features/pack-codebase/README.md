<!-- Once this directory changes, update this README.md -->

# Features/pack-codebase

Pack-codebase renderer feature — dialog UI for configuring and triggering workspace packing.
Uses `POST /workspaces/:id/pack` and writes the result to the system clipboard.

## Files

- **pack-codebase-dialog.tsx**: Full-featured dialog with format selector, compression toggle, accessible scope path input, pattern filters, and clipboard copy action
- **pack-codebase-utils.ts**: Pure helpers for scope path parsing, include glob construction, and token display labels
- **pack-codebase-utils.test.ts**: Unit coverage for comma/newline path parsing, deduplication, include globs, and token formatting
