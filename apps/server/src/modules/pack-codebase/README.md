<!--
Output: Pack-codebase module inventory.
Input: PackCodebaseModule, controller, service, engine.
Position: apps/server/src/modules/pack-codebase
-->

# Pack Codebase Module

Workspace-owned HTTP packing capability backed by `repomix`.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- **pack-codebase.module.ts**: Tsuki module registration.
- **pack-codebase.controller.ts**: `POST /workspaces/:workspaceId/pack` endpoint.
- **pack-codebase.service.ts**: capability semantics and workspace ownership checks.
- **pack-codebase.engine.ts**: repomix execution and temp-file handling.
