# Workflow Rules Module

Stores workspace-scoped workflow rule markdown files under the server-owned data directory.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `workflow-rules.module.ts`: Tsuki module registration.
- `workflow-rules.controller.ts`: HTTP endpoints.
- `workflow-rules.service.ts`: capability semantics.
- `workflow-rules.store.ts`: filesystem read/write and path safety.
- `workflow-rules.config.ts`: storage root resolution.
