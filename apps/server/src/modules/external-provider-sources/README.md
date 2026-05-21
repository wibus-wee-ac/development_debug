# External Provider Sources

This module owns host-side projection of plugin-provided provider source snapshots.

- `index.ts`: HTTP routes for listing sources, refreshing sources, listing source records, and reading profile source metadata.
- `model.ts`: Elysia response schemas for the fixed external provider source API.
- `service.ts`: Snapshot validation, source persistence, profile projection, secret upsert, missing-record handling, and view serialization.
- `profile-link-store.ts`: Low-level profile link lookup used by the profiles module to block ordinary edits to mirrored profiles without importing the full service.

Plugins do not render Provider UI and do not write Cradle profile or credential tables directly. They register external provider sources through `@cradle/plugin-sdk/server`; this module reads the registered sources and writes Cradle-owned projection state.
