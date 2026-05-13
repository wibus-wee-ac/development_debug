<!--
Output: Workspace module inventory.
Input: WorkspaceModule, service, store, file helpers.
Position: apps/server/src/modules/workspace
-->

# Workspace Module

Workspace CRUD and safe filesystem access (listing + text read/write).
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **index.ts**: Elysia `/workspaces` routes, OpenAPI metadata, and generated CLI descriptors.
- **model.ts**: TypeBox schemas for workspace requests and responses.
- **service.ts**: Workspace CRUD semantics.
- **files.ts**: `.gitignore` filtering and safe text IO.
