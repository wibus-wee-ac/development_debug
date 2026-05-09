<!--
Output: Workspace module inventory.
Input: WorkspaceModule, service, store, file helpers.
Position: apps/server/src/modules/workspace
-->

# Workspace Module

Workspace CRUD and safe filesystem access (listing + text read/write).

## Files

- **workspace.module.ts**: Tsuki module registration.
- **workspace.controller.ts**: HTTP endpoints for workspace module.
- **workspace.service.ts**: Module semantics (CRUD + file ops).
- **workspace.store.ts**: Drizzle-backed workspace store.
- **workspace.files.ts**: `.gitignore` filtering and safe text IO.
